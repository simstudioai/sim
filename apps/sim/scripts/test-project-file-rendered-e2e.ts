import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { toArray, toRecord } from '@sim/utils/object'
import JSZip from 'jszip'
import { PDFDocument, PDFName } from 'pdf-lib'
import sharp from 'sharp'

type Auth = 'session' | 'personal' | 'workspace' | 'none'
type Format = 'docx' | 'pptx' | 'pdf'
interface CreatedFile {
  id: string
  projectId: string
  name: string
  revision: string
  source?: string
}
interface Check {
  name: string
  passed: boolean
  durationMs: number
  error?: string
}

const reportPath = required(
  process.env.PROJECT_FILE_RENDERED_REPORT_PATH,
  'PROJECT_FILE_RENDERED_REPORT_PATH is required'
)
const fixtureDir = required(process.env.PROJECT_FILE_RENDERED_FIXTURE_DIR)
const runId = generateId()
const artifactDir = join(dirname(reportPath), `${basename(reportPath, '.json')}-${runId}`)
const checks: Check[] = []
const requests: { method: string; path: string; auth: Auth; status: number; durationMs: number }[] =
  []
const artifacts: { format: Format; path: string; size: number; sha256: string }[] = []
const files: CreatedFile[] = []
const archived = new Set<string>()
const documents = new Map<Format, CreatedFile>()
const rendered = new Map<Format, Buffer>()
const marker = `ProjectRendered${runId.replaceAll('-', '')}`
const mimeTypes = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
} as const
const sourceMimeTypes = {
  docx: 'text/x-docxjs',
  pptx: 'text/x-pptxgenjs',
  pdf: 'text/x-pdflibjs',
} as const
let base: URL
let cookie = ''
let keys: Record<string, unknown> = {}
let projectId = ''
let foreignProjectId = ''
let asset: CreatedFile | undefined
let foreignAsset: CreatedFile | undefined
let firstImage = Buffer.alloc(0)
let secondImage = Buffer.alloc(0)

function required(value: unknown, message = 'Required fixture field missing'): string {
  assert.ok(typeof value === 'string' && value.length > 0, message)
  return value
}

async function fixture(name: string) {
  return toRecord(JSON.parse(await readFile(join(fixtureDir, name), 'utf8')))
}

async function saveReport() {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        runId,
        boundary: 'Running HTTP application, real isolated-vm document tasks and Project assets',
        limitation: 'Remote Python/XLSX rendering is not exercised without configured credentials',
        checks,
        requests,
        artifacts,
      },
      null,
      2
    )
  )
}

async function check(name: string, run: () => Promise<void>) {
  const start = performance.now()
  try {
    await run()
    checks.push({ name, passed: true, durationMs: performance.now() - start })
    return true
  } catch (error) {
    checks.push({
      name,
      passed: false,
      durationMs: performance.now() - start,
      error: getErrorMessage(error),
    })
    return false
  } finally {
    await saveReport()
  }
}

async function request(
  method: string,
  path: string,
  auth: Auth = 'personal',
  body?: Record<string, unknown>
) {
  const headers = new Headers({ Origin: base.origin, 'Content-Type': 'application/json' })
  if (auth === 'session') headers.set('Cookie', cookie)
  if (auth === 'personal' || auth === 'workspace') headers.set('X-API-Key', required(keys[auth]))
  const start = performance.now()
  // boundary-raw-fetch: this standalone proof validates real document bytes through the disposable local HTTP app.
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  const buffer = Buffer.from(await response.arrayBuffer())
  requests.push({
    method,
    path,
    auth,
    status: response.status,
    durationMs: performance.now() - start,
  })
  return { status: response.status, headers: response.headers, buffer }
}

function json(response: Awaited<ReturnType<typeof request>>, status = 200) {
  assert.equal(response.status, status, `Expected HTTP ${status}, received ${response.status}`)
  assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  return toRecord(JSON.parse(response.buffer.toString('utf8')))
}

function filePath(file: CreatedFile) {
  return `/api/v2/projects/${file.projectId}/files/${file.id}`
}

function artifactPath(file: CreatedFile) {
  return `/api/projects/${file.projectId}/files/${file.id}/artifact`
}

function archivePath(file: CreatedFile) {
  return `/api/v2/projects/${file.projectId}/files/bulk-download?fileIds=${encodeURIComponent(file.id)}`
}

async function create(
  ownerId: string,
  name: string,
  content: string | Buffer,
  contentType: string
) {
  const data = toRecord(
    json(
      await request('POST', `/api/v2/projects/${ownerId}/files`, 'personal', {
        name,
        content: typeof content === 'string' ? content : content.toString('base64'),
        encoding: typeof content === 'string' ? 'utf-8' : 'base64',
        contentType,
      }),
      201
    ).data
  )
  const file = {
    id: required(data.id),
    projectId: ownerId,
    name,
    revision: required(data.revision),
    ...(typeof content === 'string' ? { source: content } : {}),
  }
  files.push(file)
  return file
}

function program(format: Format, imageId: string) {
  if (format === 'docx')
    return `addSection({ children: [new docx.Paragraph(${JSON.stringify(marker)}), new docx.Paragraph({ children: [await addImage(${JSON.stringify(imageId)}, {width: 32, height: 32})] })] });`
  if (format === 'pptx')
    return `const slide = pptx.addSlide(); slide.addText(${JSON.stringify(marker)}, {x: 0.5, y: 0.5, w: 8, h: 0.5}); await addImage(slide, ${JSON.stringify(imageId)}, {x: 1, y: 1, w: 1, h: 1});`
  return `const page = pdf.addPage([320, 240]); const font = await pdf.embedFont(StandardFonts.Helvetica); page.drawText(${JSON.stringify(marker)}, {x: 10, y: 210, size: 8, font}); await drawImage(page, ${JSON.stringify(imageId)}, {x: 20, y: 30, width: 64, height: 64});`
}

async function assertDocument(format: Format, buffer: Buffer, image: Buffer) {
  if (format === 'pdf') {
    assert.equal(buffer.subarray(0, 5).toString(), '%PDF-')
    const pdf = await PDFDocument.load(buffer)
    assert.equal(pdf.getPageCount(), 1)
    const page = pdf.getPage(0)
    assert.deepEqual(page.getSize(), { width: 320, height: 240 })
    assert.ok(
      page.node.Resources()?.has(PDFName.of('XObject')),
      'PDF must contain the prepared image'
    )
    return
  }
  const zip = await JSZip.loadAsync(buffer)
  const xml = zip.file(format === 'docx' ? 'word/document.xml' : 'ppt/slides/slide1.xml')
  assert.ok(xml, 'Rendered Office archive must contain its document XML')
  assert.ok(
    (await xml.async('string')).includes(marker),
    'Rendered document must contain the source marker'
  )
  const media = zip.file(format === 'docx' ? /^word\/media\// : /^ppt\/media\//)
  const bytes = await Promise.all(media.map((entry) => entry.async('nodebuffer')))
  assert.ok(
    bytes.some((value) => value.equals(image)),
    'Rendered document must embed the current Project image bytes'
  )
}

async function readArtifact(file: CreatedFile, format: Format) {
  const response = await request('GET', artifactPath(file), 'session')
  assert.equal(response.status, 200, `Real ${format} compilation returned HTTP ${response.status}`)
  assert.equal(response.headers.get('content-type')?.split(';')[0], mimeTypes[format])
  return response.buffer
}

try {
  const ready = await check(
    'Local fixtures create source documents and images through real APIs',
    async () => {
      base = new URL(process.env.PROJECT_FILE_RENDERED_BASE_URL ?? 'http://127.0.0.1:3300')
      assert.ok(
        ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname),
        'Requires a disposable loopback runtime'
      )
      keys = await fixture('v2-fixture-keys.json')
      cookie = toArray((await fixture('owner-account.json')).cookies)
        .map((value) => required(value).split(';')[0])
        .join('; ')
      assert.ok(cookie)
      projectId = required(toRecord((await fixture('http-project-fixture.json')).project).id)
      foreignProjectId =
        process.env.PROJECT_FILE_RENDERED_FOREIGN_PROJECT_ID ??
        required(
          toRecord((await fixture('public-browser-wrong-owner-fixtures.json')).wrongOwner).projectId
        )
      assert.notEqual(projectId, foreignProjectId)
      firstImage = await sharp({
        create: { width: 16, height: 16, channels: 3, background: '#0055ff' },
      })
        .png()
        .toBuffer()
      secondImage = await sharp({
        create: { width: 16, height: 16, channels: 3, background: '#ff2200' },
      })
        .png()
        .toBuffer()
      asset = await create(projectId, `rendered-${runId}.png`, firstImage, 'image/png')
      foreignAsset = await create(
        foreignProjectId,
        `rendered-foreign-${runId}.png`,
        secondImage,
        'image/png'
      )
      for (const format of ['docx', 'pptx', 'pdf'] as const) {
        documents.set(
          format,
          await create(
            projectId,
            `rendered-${runId}.${format}`,
            program(format, asset.id),
            sourceMimeTypes[format]
          )
        )
      }
    }
  )
  if (ready) {
    for (const format of ['docx', 'pptx', 'pdf'] as const) {
      await check(
        `Real ${format.toUpperCase()} rendering returns a parseable document with a Project asset`,
        async () => {
          const file = documents.get(format)
          assert.ok(file)
          const buffer = await readArtifact(file, format)
          await assertDocument(format, buffer, firstImage)
          rendered.set(format, buffer)
          const path = join(artifactDir, `rendered.${format}`)
          await mkdir(artifactDir, { recursive: true })
          await writeFile(path, buffer)
          artifacts.push({
            format,
            path,
            size: buffer.length,
            sha256: createHash('sha256').update(buffer).digest('hex'),
          })
        }
      )
    }
    await check('Personal-key bulk download returns the same compiled Office bytes', async () => {
      const file = documents.get('docx')
      const previous = rendered.get('docx')
      assert.ok(file && previous, 'A successful initial render is required')
      const response = await request('GET', archivePath(file))
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type')?.split(';')[0], 'application/zip')
      const archive = await JSZip.loadAsync(response.buffer)
      const entry = archive.file(file.name)
      assert.ok(entry)
      assert.deepEqual(await entry.async('nodebuffer'), previous)
    })
    await check(
      'Same-ID asset content revision invalidates the compiled document cache',
      async () => {
        assert.ok(asset)
        const file = documents.get('docx')
        const original = rendered.get('docx')
        assert.ok(file && original, 'A successful initial render is required')
        assert.deepEqual(await readArtifact(file, 'docx'), original)
        const updated = toRecord(
          json(
            await request('PUT', `${filePath(asset)}/content`, 'personal', {
              content: secondImage.toString('base64'),
              encoding: 'base64',
              expectedRevision: asset.revision,
            })
          ).data
        )
        assert.equal(updated.id, asset.id)
        assert.notEqual(required(updated.revision), asset.revision)
        const buffer = await readArtifact(file, 'docx')
        await assertDocument('docx', buffer, secondImage)
        assert.equal(buffer.equals(original), false)
        await writeFile(join(artifactDir, 'rendered-updated.docx'), buffer)
      }
    )
    await check('A caller with both Projects cannot compile a foreign-owner asset', async () => {
      assert.ok(foreignAsset)
      const ownRead = await request('GET', `${filePath(foreignAsset)}/content`)
      assert.equal(ownRead.status, 200)
      assert.deepEqual(ownRead.buffer, secondImage)
      const file = await create(
        projectId,
        `rendered-foreign-${runId}.docx`,
        program('docx', foreignAsset.id),
        sourceMimeTypes.docx
      )
      assert.equal((await request('GET', artifactPath(file), 'session')).status, 404)
      assert.equal((await request('GET', archivePath(file))).status, 404)
    })
    await check(
      'Cached private document bytes still reject anonymous and workspace-key callers',
      async () => {
        const file = documents.get('docx')
        assert.ok(file)
        await readArtifact(file, 'docx')
        assert.equal((await request('GET', artifactPath(file), 'none')).status, 401)
        assert.equal((await request('GET', archivePath(file), 'none')).status, 401)
        assert.equal((await request('GET', archivePath(file), 'workspace')).status, 403)
      }
    )
    await check(
      'An archived dependency cannot be delivered from a warm artifact cache',
      async () => {
        assert.ok(asset)
        const file = documents.get('docx')
        assert.ok(file)
        await readArtifact(file, 'docx')
        json(
          await request('POST', `/api/v2/projects/${projectId}/files/archive`, 'personal', {
            fileIds: [asset.id],
          })
        )
        archived.add(asset.id)
        assert.equal((await request('GET', artifactPath(file), 'session')).status, 404)
        assert.equal((await request('GET', archivePath(file))).status, 404)
      }
    )
    await check(
      'Rendering and denied re-reads preserve every editable source and revision',
      async () => {
        for (const file of files.filter((file) => file.source !== undefined)) {
          const response = await request('GET', `${filePath(file)}/content`)
          assert.equal(response.status, 200)
          assert.equal(response.buffer.toString('utf8'), file.source)
          const metadata = toRecord(json(await request('GET', `${filePath(file)}/metadata`)).data)
          assert.equal(metadata.revision, file.revision)
        }
      }
    )
  }
} catch (error) {
  checks.push({
    name: 'Harness completion',
    passed: false,
    durationMs: 0,
    error: getErrorMessage(error),
  })
} finally {
  await check('Archive only fixtures created by this run', async () => {
    const owners = new Set(files.map((file) => file.projectId))
    for (const owner of owners) {
      const fileIds = files
        .filter((file) => file.projectId === owner && !archived.has(file.id))
        .map((file) => file.id)
      if (fileIds.length)
        json(
          await request('POST', `/api/v2/projects/${owner}/files/archive`, 'personal', { fileIds })
        )
    }
  })
  await saveReport()
  process.exitCode = checks.some((entry) => !entry.passed) ? 1 : 0
}
