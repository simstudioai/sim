import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { getErrorMessage } from '@sim/utils/errors'
import { truncate } from '@sim/utils/string'
import JSZip from 'jszip'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { isHosted } from '@/lib/core/config/env-flags'
import { DocxParser } from '@/lib/file-parsers/docx-parser'
import { PdfParser } from '@/lib/file-parsers/pdf-parser'
import { readDrive, readGmail } from '@/lib/sim-search/live/google'
import { createNativeClient, NativeSearchError } from '@/lib/sim-search/live/http'
import { createPolicyVerifier } from '@/lib/sim-search/live/policy'
import { defaultLiveSearchPolicy } from '@/lib/sim-search/live/policy-schema'

/**
 * Exercises Drive content reads over a real loopback HTTP server with real document parsers.
 * Run from apps/sim:
 * NEXT_PUBLIC_APP_URL=http://localhost:3040 NEXT_PUBLIC_FORCE_HOSTED=false \
 * SEARCH_GOOGLE_CONTENT_REPORT_PATH=/tmp/google-content.json \
 * bun scripts/test-search-google-content-e2e.ts
 * Fixtures are synthetic. No Google credentials or remote writes are used. This verifies the
 * native transport, Drive adapter and parsers; connected-account authorization and UI are
 * separate acceptance boundaries. The server uses the existing self-hosted loopback policy.
 */
const logger = createLogger('SearchGoogleContentE2E')
const reportPath = process.env.SEARCH_GOOGLE_CONTENT_REPORT_PATH
assert(reportPath, 'Set SEARCH_GOOGLE_CONTENT_REPORT_PATH')
assert(!isHosted, 'Use a local self-hosted app URL with NEXT_PUBLIC_FORCE_HOSTED=false')
const PDF_MIME = 'application/pdf'
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const MIB = 1024 * 1024
const TOKEN = 'synthetic-loopback-token'
const SOURCE = 'https://drive.google.com/file/d/synthetic-file/view'
const COMMENT = 'Synthetic reviewer requests a revised launch estimate.'
const checks: { name: string; status: 'passed' | 'failed'; durationMs: number; error?: string }[] =
  []
const requests: {
  id: string
  resource: 'metadata' | 'media' | 'comments' | 'message' | 'thread' | 'labels' | 'attachment'
  status: number
}[] = []

interface Fixture {
  mimeType: string
  body: Buffer
  metadata?: Record<string, unknown>
  mode?: 'stall' | 'overflow'
}
const fixtures = new Map<string, Fixture>()
interface GmailPart {
  mimeType: string
  filename?: string
  headers?: { name: string; value: string }[]
  body?: { data?: string; attachmentId?: string; size?: number }
  parts?: GmailPart[]
}
interface GmailMessage {
  id: string
  threadId: string
  labelIds: string[]
  internalDate: string
  snippet?: string
  payload: GmailPart
}
const mailbox: GmailMessage[] = Array.from({ length: 12 }, (_, index) => ({
  id: `mail${index}`,
  threadId: 'conversation',
  labelIds: ['INBOX'],
  internalDate: String(Date.UTC(2026, 0, 1, 12, index)),
  payload: {
    mimeType: 'text/plain',
    headers: [{ name: 'Subject', value: 'Synthetic planning' }],
    body: { data: Buffer.from(`Synthetic evidence ${index}.`).toString('base64url') },
  },
}))
const messageFailures = new Map<string, { status: number; format: string }>()
const mediaStarted = createDeferred<void>()
const mediaClosed = createDeferred<void>()
const server = http.createServer((request, response) => {
  if (request.headers.authorization !== `Bearer ${TOKEN}`) {
    response.writeHead(401).end()
    return
  }
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname.startsWith('/gmail/v1/users/me/')) {
    const id = url.pathname.split('/').at(-1) ?? ''
    const row = mailbox.find((message) => message.id === id)
    const isThread = url.pathname.startsWith('/gmail/v1/users/me/threads/')
    const isAttachment = url.pathname.includes('/attachments/')
    const failure = !isThread ? messageFailures.get(id) : undefined
    if (failure && url.searchParams.get('format') === failure.format) {
      requests.push({ id, resource: 'message', status: failure.status })
      response
        .writeHead(failure.status, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: { code: failure.status } }))
      return
    }
    const threadMessages = isThread ? mailbox.filter((message) => message.threadId === id) : []
    const metadata = (message: (typeof mailbox)[number]) => ({
      ...message,
      payload: { headers: message.payload.headers },
    })
    const data =
      id === 'labels'
        ? { labels: [{ id: 'INBOX', name: 'INBOX' }] }
        : isThread && threadMessages.length > 0 && url.searchParams.get('format') === 'metadata'
          ? { id, messages: threadMessages.map(metadata) }
          : row
            ? url.searchParams.get('format') === 'full'
              ? row
              : metadata(row)
            : undefined
    requests.push({
      id,
      resource: isAttachment
        ? 'attachment'
        : id === 'labels'
          ? 'labels'
          : isThread
            ? 'thread'
            : 'message',
      status: data ? 200 : 400,
    })
    response
      .writeHead(data ? 200 : 400, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(data ?? {}))
    return
  }
  const match = /^\/drive\/v3\/files\/([^/]+)(\/comments)?$/.exec(url.pathname)
  const id = match?.[1] ?? ''
  const fixture = fixtures.get(id)
  if (!fixture) {
    response.writeHead(404).end()
    return
  }
  const resource = match?.[2]
    ? 'comments'
    : url.searchParams.get('alt') === 'media'
      ? 'media'
      : 'metadata'
  requests.push({ id, resource, status: 200 })
  if (resource === 'media') {
    response.writeHead(200, { 'Content-Type': fixture.mimeType })
    if (fixture.mode === 'stall') {
      request.socket.once('close', () => mediaClosed.resolve())
      response.write(fixture.body.subarray(0, 8))
      mediaStarted.resolve()
    } else if (fixture.mode === 'overflow') {
      response.write(Buffer.alloc(4 * MIB + 1, 0x41))
    } else response.end(fixture.body)
    return
  }
  response.setHeader('Content-Type', 'application/json')
  const fields = url.searchParams.get('fields') ?? ''
  const metadata = {
    id,
    name: 'Synthetic document title',
    description: 'Synthetic metadata description only.',
    mimeType: fixture.mimeType,
    size: String(fixture.body.length),
    capabilities: { canDownload: true },
    webViewLink: SOURCE,
    modifiedTime: '2026-01-01T12:00:00Z',
    ...fixture.metadata,
  }
  if (!fields.includes('size') && fields !== '*') Reflect.deleteProperty(metadata, 'size')
  if (!fields.includes('capabilities') && fields !== '*')
    Reflect.deleteProperty(metadata, 'capabilities')
  response.end(
    JSON.stringify(
      resource === 'comments'
        ? {
            comments: [
              {
                id: 'synthetic-comment',
                content: COMMENT,
                createdTime: '2026-01-02T12:00:00Z',
                author: { displayName: 'Synthetic Reviewer' },
              },
            ],
          }
        : metadata
    )
  )
})

async function check(name: string, run: () => Promise<void>) {
  const started = performance.now()
  try {
    await run()
    checks.push({ name, status: 'passed', durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - started),
      error: truncate(getErrorMessage(error), 1000),
    })
  }
}

async function pdf(pages: string[]): Promise<Buffer> {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  for (const text of pages) {
    const page = document.addPage([612, 792])
    if (text)
      page.drawText(text, { x: 40, y: 720, font, size: text.length > 1000 ? 4 : 12, lineHeight: 8 })
    else page.drawRectangle({ x: 40, y: 40, width: 100, height: 100 })
  }
  return Buffer.from(await document.save())
}

async function docx(body: string, parts: Record<string, Buffer> = {}): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  )
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  )
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
  )
  for (const [name, bytes] of Object.entries(parts)) zip.file(name, bytes)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

/** A real password-required PDF structure; no decrypted content is embedded. */
function encryptedPdf(): Buffer {
  const key = '00'.repeat(32)
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    `<< /Filter /Standard /V 1 /R 2 /O <${key}> /U <${key}> /P -4 >>`,
  ]
  let text = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(text)
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = Buffer.byteLength(text)
  text += `xref\n0 5\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${'11'.repeat(16)}> <${'11'.repeat(16)}>] >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(text)
}

function paragraph(text: string): string {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`
}

let origin = ''
async function read(id: string, signal = AbortSignal.timeout(5000)) {
  const api = createNativeClient({ origin, accessToken: TOKEN, signal })
  return readDrive(api, id, signal)
}
async function readMailFixture(payload: GmailPart, snippet?: string) {
  const id = `mime${mailbox.length}`
  mailbox.push({
    id,
    threadId: `conversation-${id}`,
    labelIds: ['INBOX'],
    internalDate: String(Date.UTC(2026, 0, 1, 12, 0)),
    snippet,
    payload,
  })
  const signal = AbortSignal.timeout(5000)
  const api = createNativeClient({ origin, accessToken: TOKEN, signal })
  const policy = defaultLiveSearchPolicy('gmail')
  const verify = createPolicyVerifier('gmail', policy, api, origin)
  return readGmail(api, id, { policy, signal, verify })
}
async function unavailable(id: string) {
  await assert.rejects(
    read(id),
    (error: unknown) => error instanceof NativeSearchError && error.status === 'unavailable'
  )
}

try {
  const started = createDeferred<void>()
  server.once('error', started.reject)
  server.listen(0, '127.0.0.1', () => started.resolve())
  await started.promise
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  for (const { name, failedId, status, expectedStatus } of [
    { name: 'healthy conversation', failedId: '', status: 200 },
    { name: 'missing sibling', failedId: 'reply', status: 404 },
    { name: 'missing anchor', failedId: 'anchor', status: 404, expectedStatus: 'unavailable' },
    { name: 'expired credentials', failedId: 'reply', status: 401, expectedStatus: 'reconnect' },
    { name: 'denied credentials', failedId: 'reply', status: 403, expectedStatus: 'reconnect' },
    { name: 'rate limit', failedId: 'reply', status: 429, expectedStatus: 'rate_limited' },
    { name: 'server failure', failedId: 'reply', status: 500, expectedStatus: 'unavailable' },
  ]) {
    for (const format of failedId === 'reply' ? ['metadata', 'full'] : ['full']) {
      await check(
        `Gmail conversation handles ${name} during ${format} reads without hiding unrelated failures`,
        async () => {
          const before = mailbox.length
          mailbox.push(
            ...['anchor', 'retained', 'reply'].map((id, index) => ({
              id,
              threadId: 'failure-conversation',
              labelIds: ['INBOX'],
              internalDate: String(Date.UTC(2026, 0, 1, 12, index)),
              payload: {
                mimeType: 'text/plain',
                body: { data: Buffer.from(`Synthetic ${id} evidence.`).toString('base64url') },
              },
            }))
          )
          if (failedId) messageFailures.set(failedId, { status, format })
          try {
            const signal = AbortSignal.timeout(5000)
            const api = createNativeClient({ origin, accessToken: TOKEN, signal })
            const policy = {
              ...defaultLiveSearchPolicy('gmail'),
              mode: 'selected' as const,
              included: ['INBOX'],
            }
            const verify = createPolicyVerifier('gmail', policy, api, origin)
            assert.ok(await verify({ id: 'anchor' }))
            const reading = readGmail(api, 'anchor', {
              policy,
              signal,
              verify: (reference) =>
                verify(reference, format === 'full' ? reference.accessMetadata : undefined),
            })
            if (expectedStatus) {
              await assert.rejects(
                reading,
                (error: unknown) =>
                  error instanceof NativeSearchError && error.status === expectedStatus
              )
              return
            }
            const document = await reading
            assert.equal(document.id, 'anchor')
            assert.ok(document.content.includes('Synthetic anchor evidence.'))
            assert.ok(document.content.includes('Synthetic retained evidence.'))
            assert.equal(document.content.includes('Synthetic reply evidence.'), status === 200)
            assert.equal(document.content.includes('Coverage incomplete:'), status === 404)
            assert.deepEqual(
              document.accessDependencies,
              status === 404 ? [{ id: 'retained' }] : [{ id: 'retained' }, { id: 'reply' }]
            )
            const current = createPolicyVerifier('gmail', policy, api, origin, undefined, {
              fresh: true,
            })
            assert.ok(await current({ id: document.id }))
            for (const dependency of document.accessDependencies ?? [])
              assert.ok(await current(dependency))
          } finally {
            mailbox.splice(before)
            messageFailures.clear()
          }
        }
      )
    }
  }
  await check(
    'Gmail conversation and fresh selected-label checks fit one native request budget',
    async () => {
      const signal = AbortSignal.timeout(5000)
      const api = createNativeClient({ origin, accessToken: TOKEN, signal })
      const policy = {
        ...defaultLiveSearchPolicy('gmail'),
        mode: 'selected' as const,
        included: ['INBOX'],
      }
      const verify = createPolicyVerifier('gmail', policy, api, origin)
      assert.ok(await verify({ id: 'mail11' }))
      const document = await readGmail(api, 'mail11', {
        policy,
        signal,
        verify: (reference) => verify(reference, reference.accessMetadata),
      })
      assert.equal(document.id, 'mail11')
      assert.equal(
        mailbox.filter((_message, index) =>
          document.content.includes(`Synthetic evidence ${index}.`)
        ).length,
        8
      )
      const current = createPolicyVerifier('gmail', policy, api, origin, undefined, { fresh: true })
      assert.ok(await current({ id: document.id }))
      for (const reference of document.accessDependencies ?? []) assert.ok(await current(reference))
    }
  )
  await check(
    'Gmail MIME alternatives contribute one body rather than duplicate evidence',
    async () => {
      const evidence = 'Synthetic MIME alternative evidence.'
      const document = await readMailFixture({
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from(`<p>${evidence}</p>`).toString('base64url') },
          },
          {
            mimeType: 'text/plain',
            body: { data: Buffer.from(evidence).toString('base64url') },
          },
        ],
      })
      assert.equal(document.content.split(evidence).length - 1, 1)
    }
  )
  await check('Gmail named text attachments do not become message evidence', async () => {
    const evidence = 'Synthetic message body remains readable.'
    const attachment = 'Synthetic attachment content is not a message statement.'
    const document = await readMailFixture({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from(evidence).toString('base64url') },
        },
        {
          mimeType: 'text/plain',
          filename: 'synthetic-notes.txt',
          body: { data: Buffer.from(attachment).toString('base64url') },
        },
      ],
    })
    assert.ok(document.content.includes(evidence))
    assert.ok(!document.content.includes(attachment))
  })
  await check(
    'Gmail external body previews disclose missing content without attachment fanout',
    async () => {
      const before = requests.length
      const preview = 'Synthetic preview only.'
      const document = await readMailFixture(
        { mimeType: 'text/plain', body: { attachmentId: 'synthetic-body', size: 1200 } },
        preview
      )
      assert.ok(document.content.includes(preview))
      assert.match(document.content, /incomplete/i)
      assert.equal(
        requests.slice(before).filter((request) => request.resource === 'attachment').length,
        0
      )
    }
  )
  await check('Gmail MIME depth limits omit deep content with an incomplete notice', async () => {
    const evidence = 'Synthetic deeply nested body must be omitted.'
    let payload: GmailPart = {
      mimeType: 'text/plain',
      body: { data: Buffer.from(evidence).toString('base64url') },
    }
    for (let depth = 0; depth < 40; depth++)
      payload = { mimeType: 'multipart/mixed', parts: [payload] }
    const document = await readMailFixture(payload, 'Synthetic nested body preview.')
    assert.match(document.content, /incomplete/i)
    assert.ok(!document.content.includes(evidence))
  })
  await check(
    'Gmail MIME part limits preserve early sections and disclose omitted content',
    async () => {
      const document = await readMailFixture({
        mimeType: 'multipart/mixed',
        parts: Array.from({ length: 300 }, (_, index) => ({
          mimeType: 'text/plain',
          body: { data: Buffer.from(`Synthetic section ${index}.`).toString('base64url') },
        })),
      })
      assert.ok(document.content.includes('Synthetic section 0.'))
      assert.ok(!document.content.includes('Synthetic section 299.'))
      assert.match(document.content, /incomplete/i)
    }
  )
  const pdfBody = await pdf([
    'The synthetic launch budget is forty-two credits.',
    'The launch owner is the synthetic research team.',
  ])
  const wordBody = await docx(
    paragraph('The synthetic decision is to launch on Tuesday.') +
      '<w:tbl><w:tr><w:tc>' +
      paragraph('Synthetic table budget') +
      '</w:tc><w:tc>' +
      paragraph('Seventy credits') +
      '</w:tc></w:tr></w:tbl>'
  )
  fixtures.set('pdf', { mimeType: PDF_MIME, body: pdfBody })
  fixtures.set('docx', { mimeType: DOCX_MIME, body: wordBody })

  for (const [id, evidence] of [
    [
      'pdf',
      [
        'The synthetic launch budget is forty-two credits.',
        'The launch owner is the synthetic research team.',
      ],
    ],
    [
      'docx',
      [
        'The synthetic decision is to launch on Tuesday.',
        'Synthetic table budget',
        'Seventy credits',
      ],
    ],
  ] as const) {
    await check(`${id} bytes produce attributed document text and retain discussion`, async () => {
      const document = await read(id)
      for (const expected of [...evidence, SOURCE, COMMENT])
        assert.ok(document.content.includes(expected), `Missing synthetic evidence: ${expected}`)
      assert.equal(document.id, id)
      assert.equal(document.url, SOURCE)
    })
  }

  const noteReference = (id: number) => `<w:r><w:footnoteReference w:id="${id}"/></w:r>`
  const notesPart = (body: string) => ({
    'word/footnotes.xml': Buffer.from(
      `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="1">${body}</w:footnote></w:footnotes>`
    ),
  })
  const repeatedNote = 'Synthetic footnote evidence survives each reference.'
  fixtures.set('docx-repeated-note', {
    mimeType: DOCX_MIME,
    body: await docx(
      `<w:p><w:r><w:t>Synthetic cited body.</w:t></w:r>${noteReference(1)}${noteReference(1)}</w:p>`,
      notesPart(paragraph(repeatedNote))
    ),
  })
  await check('DOCX reads retain each referenced note within the extraction budget', async () => {
    const document = await read('docx-repeated-note')
    assert.ok(document.content.includes('Synthetic cited body.'))
    assert.equal(document.content.split(repeatedNote).length - 1, 2)
  })

  const paddedImage = Buffer.concat([
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=',
      'base64'
    ),
    randomBytes(MIB),
  ])
  const imageReferences = Array.from(
    { length: 25 },
    (_, index) =>
      `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="synthetic-image-${index}" style="width:1pt;height:1pt"><v:imagedata xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdImage"/></v:shape></w:pict></w:r></w:p>`
  ).join('')
  fixtures.set('docx-repeated-image', {
    mimeType: DOCX_MIME,
    body: await docx(
      `<w:p><w:r><w:t>Synthetic body with image references.</w:t></w:r>${noteReference(1)}</w:p>${imageReferences}`,
      {
        ...notesPart(paragraph(repeatedNote)),
        '[Content_Types].xml': Buffer.from(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/></Types>'
        ),
        'word/_rels/document.xml.rels': Buffer.from(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/synthetic.png"/><Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/></Relationships>'
        ),
        'word/media/synthetic.png': paddedImage,
      }
    ),
  })
  await check('DOCX image references cannot displace readable body and note evidence', async () => {
    const document = await read('docx-repeated-image')
    assert.ok(document.content.includes('Synthetic body with image references.'))
    assert.ok(document.content.includes(repeatedNote))
  })

  const amplifiedNote = randomBytes(225_000).toString('base64')
  fixtures.set('docx-amplified-note', {
    mimeType: DOCX_MIME,
    body: await docx(
      `<w:p><w:r><w:t>Synthetic cited body.</w:t></w:r>${noteReference(1).repeat(32)}${noteReference(2)}</w:p>`,
      notesPart(paragraph(amplifiedNote))
    ),
  })
  fixtures.set('docx-structural-complexity', {
    mimeType: DOCX_MIME,
    body: await docx(
      paragraph('Synthetic body before excessive structural elements.') +
        `<w:p><w:r>${'<w:tab/>'.repeat(50_001)}</w:r></w:p>`
    ),
  })
  for (const id of ['docx-amplified-note', 'docx-structural-complexity']) {
    await check(`${id} rejects before a fallback can return incomplete text`, async () => {
      await assert.rejects(
        read(id),
        (error: unknown) =>
          error instanceof NativeSearchError && /live text extraction limits/.test(error.message)
      )
    })
  }
  await check(
    'DOCX callers without complete mode retain their existing extraction behavior',
    async () => {
      const expected = '🙂'.repeat(17)
      const bytes = await docx(paragraph(expected))
      const result = await new DocxParser().parseBuffer(bytes, {
        contentMode: 'complete',
        maxTextBytes: 64,
      })
      assert.equal(result.content, expected)
    }
  )
  await check('DOCX extraction honors a caller UTF-8 text budget', async () => {
    const bytes = await docx(paragraph('🙂'.repeat(17)))
    await assert.rejects(
      new DocxParser().parseBuffer(bytes, { docxTextMode: 'complete', maxTextBytes: 64 }),
      {
        code: 'complexity_limit',
      }
    )
  })

  for (const [id, metadata] of [
    ['download-denied', { capabilities: { canDownload: false } }],
    ['download-unknown', { capabilities: {} }],
    ['wrong-identity', { id: 'another-synthetic-file' }],
    ['declared-oversized', { size: String(4 * MIB + 1) }],
  ] as const) {
    fixtures.set(id, { mimeType: PDF_MIME, body: pdfBody, metadata })
    await check(`${id} rejects before downloading file bytes`, async () => {
      await unavailable(id)
      assert.equal(
        requests.filter((request) => request.id === id && request.resource === 'media').length,
        0
      )
    })
  }

  const negativeFixtures: [string, Fixture][] = [
    [
      'pdf-text-mismatch',
      {
        mimeType: PDF_MIME,
        body: Buffer.from('Provider diagnostic text must not become PDF content'),
      },
    ],
    [
      'docx-html-mismatch',
      {
        mimeType: DOCX_MIME,
        body: Buffer.from(
          '<html><body>Provider error page must not become DOCX content</body></html>'
        ),
      },
    ],
    ['cross-format-mismatch', { mimeType: PDF_MIME, body: wordBody }],
    ['malformed-pdf', { mimeType: PDF_MIME, body: Buffer.from('%PDF-1.4\nnot a valid document') }],
    ['malformed-docx', { mimeType: DOCX_MIME, body: Buffer.from('PK\x03\x04broken archive') }],
    ['encrypted-pdf', { mimeType: PDF_MIME, body: encryptedPdf() }],
    ['text-free-pdf', { mimeType: PDF_MIME, body: await pdf(['']) }],
    ['text-free-docx', { mimeType: DOCX_MIME, body: await docx('<w:p/>') }],
    [
      'too-many-pdf-pages',
      {
        mimeType: PDF_MIME,
        body: await pdf(
          Array.from({ length: 101 }, (_, index) =>
            index === 0 ? 'The synthetic page limit evidence remains readable.' : ''
          )
        ),
      },
    ],
    [
      'pdf-output-cap',
      {
        mimeType: PDF_MIME,
        body: await pdf(
          Array.from({ length: 90 }, (_, page) =>
            Array.from(
              { length: 80 },
              (_, line) => `${page}-${line} ${'budget evidence '.repeat(12)}`
            ).join('\n')
          )
        ),
      },
    ],
    [
      'docx-output-cap',
      { mimeType: DOCX_MIME, body: await docx(paragraph(randomBytes(790_000).toString('base64'))) },
    ],
    [
      'docx-entry-cap',
      {
        mimeType: DOCX_MIME,
        body: await docx(paragraph('Small synthetic body'), {
          'word/media/oversized.bin': Buffer.concat([
            randomBytes(2 * MIB),
            Buffer.alloc(2 * MIB + 1),
          ]),
        }),
      },
    ],
    [
      'docx-total-cap',
      {
        mimeType: DOCX_MIME,
        body: await docx(
          paragraph('Small synthetic body'),
          Object.fromEntries(
            [1, 2, 3].map((index) => [
              `word/media/part-${index}.bin`,
              Buffer.concat([randomBytes(MIB), Buffer.alloc(4 * MIB - 1024 - MIB)]),
            ])
          )
        ),
      },
    ],
  ]
  for (const [id, fixture] of negativeFixtures) {
    fixtures.set(id, fixture)
    await check(`${id} rejects instead of returning metadata as extracted content`, () =>
      unavailable(id)
    )
  }

  fixtures.set('stream-overflow', {
    mimeType: PDF_MIME,
    body: pdfBody,
    mode: 'overflow',
    metadata: { size: undefined },
  })
  await check('chunked media overflow reports an actionable unavailable result', async () => {
    await assert.rejects(
      read('stream-overflow'),
      (error: unknown) =>
        error instanceof NativeSearchError &&
        error.status === 'unavailable' &&
        /4 MiB/.test(error.message)
    )
    assert.equal(
      requests.filter((request) => request.id === 'stream-overflow' && request.resource === 'media')
        .length,
      1
    )
  })

  fixtures.set('cancel-stream', { mimeType: PDF_MIME, body: pdfBody, mode: 'stall' })
  await check(
    'cancelling a media read closes its upstream and releases no partial document',
    async () => {
      const controller = new AbortController()
      const reading = read(
        'cancel-stream',
        AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])
      )
      try {
        await Promise.race([
          mediaStarted.promise,
          reading.then(() => assert.fail('A PDF read returned without requesting its bytes')),
        ])
        controller.abort(new DOMException('Synthetic read cancelled', 'AbortError'))
        await assert.rejects(
          reading,
          (error: unknown) => error instanceof Error && /abort|cancel/i.test(error.message)
        )
        await Promise.race([
          mediaClosed.promise,
          new Promise<never>((_resolve, reject) =>
            AbortSignal.timeout(1000).addEventListener(
              'abort',
              () => reject(new Error('Cancelled media connection stayed open')),
              { once: true }
            )
          ),
        ])
      } finally {
        controller.abort()
      }
    }
  )

  for (const { name, pages, expected, budget } of [
    {
      name: 'ASCII text below its byte budget',
      pages: ['A'.repeat(60)],
      expected: 'A'.repeat(60),
      budget: 64,
    },
    {
      name: 'ASCII text exactly at its byte budget',
      pages: ['B'.repeat(64)],
      expected: 'B'.repeat(64),
      budget: 64,
    },
    {
      name: 'UTF-8 text below its byte budget',
      pages: ['€'.repeat(20)],
      expected: '€'.repeat(20),
      budget: 64,
    },
    {
      name: 'normalized text at its byte budget',
      pages: ['   Text   '],
      expected: 'Text',
      budget: 4,
    },
    {
      name: 'page separators at the byte budget',
      pages: ['A'.repeat(30), 'B'.repeat(32)],
      expected: `${'A'.repeat(30)}\n\n${'B'.repeat(32)}`,
      budget: 64,
    },
  ]) {
    await check(`PDF complete extraction accepts ${name}`, async () => {
      const result = await new PdfParser().parseBuffer(await pdf(pages), {
        pdfTextMode: 'complete',
        maxTextBytes: budget,
      })
      assert.equal(result.content, expected)
    })
  }
  await check('PDF output byte budget includes separators between rendered pages', async () => {
    const pages = await pdf(['A'.repeat(30), 'B'.repeat(32)])
    await assert.rejects(
      new PdfParser().parseBuffer(pages, { pdfTextMode: 'complete', maxTextBytes: 63 }),
      { code: 'complexity_limit' }
    )
  })

  await check('PDF complete extraction enforces the caller page budget', async () => {
    await assert.rejects(
      new PdfParser().parseBuffer(pdfBody, { pdfTextMode: 'complete', pdfMaxPages: 1 }),
      { code: 'complexity_limit' }
    )
  })
  await check(
    'PDF complete extraction counts UTF-8 bytes against the caller output budget',
    async () => {
      const multibyte = await pdf(['€'.repeat(30)])
      await assert.rejects(
        new PdfParser().parseBuffer(multibyte, { pdfTextMode: 'complete', maxTextBytes: 64 }),
        { code: 'complexity_limit' }
      )
    }
  )
  await check('an already-cancelled read makes no provider request', async () => {
    const before = requests.length
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(read('pdf', controller.signal))
    assert.equal(requests.length, before)
  })
} catch (error) {
  checks.push({
    name: 'Synthetic HTTP acceptance setup',
    status: 'failed',
    durationMs: 0,
    error: truncate(getErrorMessage(error), 1000),
  })
} finally {
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        boundary:
          'Real loopback HTTP native client, Drive adapter and document parsers; synthetic fixtures; no application authorization or connected Google account.',
        checks,
        requests,
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
}
const failed = checks.filter((check) => check.status === 'failed').length
logger.info('Google content acceptance completed', {
  passed: checks.length - failed,
  failed,
  reportPath,
})
if (failed) process.exitCode = 1
