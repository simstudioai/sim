import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, get, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { NodeNextRequest, NodeNextResponse } from 'next/dist/server/base-http/node'
import { patchSetHeaderWithCookieSupport } from 'next/dist/server/lib/patch-set-header'
import { addRequestMeta } from 'next/dist/server/request-meta'
import { sendResponse } from 'next/dist/server/send-response'

const logger = createLogger('DocsHeaderMergeE2E')
const reportPath = process.env.DOCS_HEADER_REPORT_PATH
if (!reportPath) throw new Error('DOCS_HEADER_REPORT_PATH is required')

interface HeaderCase {
  name: string
  header: string
  before?: string | string[]
  value: string | string[]
  expected?: string[]
  rejected?: boolean
  middlewareCookies?: string[]
}

const cases: HeaderCase[] = [
  {
    name: 'existing Vary survives a later write',
    header: 'Vary',
    before: 'Origin',
    value: 'RSC',
    expected: ['origin', 'rsc'],
  },
  {
    name: 'array fields survive a later write',
    header: 'Vary',
    before: ['Accept', 'rSc'],
    value: ['RSC', 'Next-Url'],
    expected: ['accept', 'rsc', 'next-url'],
  },
  {
    name: 'mixed casing does not duplicate fields',
    header: 'Vary',
    before: 'Accept, rSc',
    value: 'RSC, aCcEpT, Next-Url, RSC',
    expected: ['accept', 'rsc', 'next-url'],
  },
  {
    name: 'wildcard remains the only field',
    header: 'Vary',
    before: '*',
    value: 'RSC',
    expected: ['*'],
  },
  {
    name: 'invalid bytes cannot be trimmed away',
    header: 'Vary',
    value: 'RSC\r\n',
    rejected: true,
  },
  {
    name: 'wildcard cannot hide invalid array bytes',
    header: 'Vary',
    value: ['*', 'bad\r\nheader'],
    rejected: true,
  },
  {
    name: 'other headers retain replacement behavior',
    header: 'X-Probe',
    before: 'old',
    value: 'new',
    expected: ['new'],
  },
  {
    name: 'middleware cookies remain present',
    header: 'Set-Cookie',
    value: ['probe_b=2'],
    middlewareCookies: ['probe_a=1'],
    expected: ['probe_a=1', 'probe_b=2'],
  },
]

interface FramingCase {
  name: string
  body: string
  headers: Record<string, string>
  expected: { 'content-length'?: string; 'content-encoding'?: string }
  forbidden?: string[]
}

const framingBody = 'route handler body'
const framingCases: FramingCase[] = [
  {
    name: 'an unencoded body keeps its declared length',
    body: framingBody,
    headers: { 'Content-Length': String(framingBody.length) },
    expected: { 'content-length': String(framingBody.length) },
  },
  {
    name: 'an identity coding keeps its length and coding',
    body: framingBody,
    headers: { 'Content-Encoding': 'identity', 'Content-Length': String(framingBody.length) },
    expected: { 'content-length': String(framingBody.length), 'content-encoding': 'identity' },
  },
  {
    name: 'a streaming response keeps its no-compression marker',
    body: framingBody,
    headers: { 'Content-Encoding': 'none' },
    expected: { 'content-encoding': 'none' },
  },
  {
    name: 'a transparently decoded body drops its stale length and coding',
    body: framingBody,
    headers: { 'Content-Encoding': 'gzip', 'Content-Length': '7' },
    expected: {},
    forbidden: ['content-length', 'content-encoding'],
  },
  {
    name: 'a declared transfer coding is never forwarded',
    body: framingBody,
    headers: { 'Transfer-Encoding': 'gzip, chunked' },
    expected: {},
  },
]

const require = createRequire(import.meta.url)
const esmPath = require.resolve('next/dist/esm/server/lib/patch-set-header.js')
const imported: unknown = await import(pathToFileURL(esmPath).href)
const esmPatch = toRecord(imported).patchSetHeaderWithCookieSupport
if (typeof esmPatch !== 'function') throw new Error('The ESM header merger is unavailable')
const esmSendPath = require.resolve('next/dist/esm/server/send-response.js')
const esmSendResponse = toRecord(await import(pathToFileURL(esmSendPath).href)).sendResponse
if (typeof esmSendResponse !== 'function') throw new Error('The ESM response sender is unavailable')
const senders: Array<{ name: string; send: typeof sendResponse }> = [
  { name: 'CommonJS', send: sendResponse },
  {
    name: 'ESM',
    send: async (req, res, response) => {
      await esmSendResponse(req, res, response)
    },
  },
]

const variants: Array<{
  name: string
  apply: (req: IncomingMessage, res: ServerResponse) => void
}> = [
  { name: 'CommonJS', apply: patchSetHeaderWithCookieSupport },
  {
    name: 'ESM',
    apply: (req, res) => {
      esmPatch(req, res)
    },
  },
]
const checks: Array<{
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}> = []

const suiteStarted = performance.now()
try {
  for (const variant of variants) {
    const server = createServer((req, res) => {
      const entry = cases[Number(req.url?.slice(1))]
      if (!entry) {
        res.writeHead(404).end()
        return
      }
      try {
        variant.apply(req, res)
        if (entry.middlewareCookies)
          addRequestMeta(req, 'middlewareCookie', entry.middlewareCookies)
        if (entry.before) res.setHeader(entry.header, entry.before)
      } catch (error) {
        res.statusCode = 500
        res.end(JSON.stringify({ error: getErrorMessage(error) }))
        return
      }
      try {
        res.setHeader(entry.header, entry.value)
        res.end(JSON.stringify({ accepted: true }))
      } catch (error) {
        res.statusCode = 400
        res.end(JSON.stringify({ rejected: true, code: toRecord(error).code }))
      }
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('No loopback listener is available')
      for (const [index, entry] of cases.entries()) {
        const started = performance.now()
        let error: string | undefined
        try {
          const response = await fetch(`http://127.0.0.1:${address.port}/${index}`, {
            signal: AbortSignal.timeout(5000),
          })
          const payload: unknown = await response.json()
          if (entry.rejected) {
            const body = toRecord(payload)
            if (
              response.status !== 400 ||
              body.rejected !== true ||
              body.code !== 'ERR_INVALID_CHAR'
            )
              throw new Error('Invalid header bytes were accepted')
          } else {
            const fields =
              entry.header === 'Set-Cookie'
                ? response.headers.getSetCookie()
                : (response.headers.get(entry.header) ?? '')
                    .split(',')
                    .map((field) => field.trim().toLowerCase())
            const expected = [...(entry.expected ?? [])].sort()
            if (
              response.status !== 200 ||
              new Set(fields).size !== fields.length ||
              JSON.stringify([...fields].sort()) !== JSON.stringify(expected)
            )
              throw new Error(`Unexpected response fields: ${JSON.stringify(fields)}`)
          }
        } catch (caught) {
          error = getErrorMessage(caught)
        }
        checks.push({
          name: `${variant.name}: ${entry.name}`,
          status: error ? 'failed' : 'passed',
          durationMs: Math.round(performance.now() - started),
          ...(error ? { error } : {}),
        })
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
  for (const sender of senders) {
    const server = createServer((req, res) => {
      const entry = framingCases[Number(req.url?.slice(1))]
      if (!entry) {
        res.writeHead(404).end()
        return
      }
      sender
        .send(
          new NodeNextRequest(req),
          new NodeNextResponse(res),
          new Response(entry.body, { headers: entry.headers })
        )
        .catch((error: unknown) => {
          res.statusCode = 500
          res.end(getErrorMessage(error))
        })
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (!address || typeof address === 'string')
        throw new Error('No loopback listener is available')
      for (const [index, entry] of framingCases.entries()) {
        const started = performance.now()
        let error: string | undefined
        try {
          const { status, headers, body } = await new Promise<{
            status: number
            headers: IncomingMessage['headers']
            body: string
          }>((resolve, reject) => {
            const request = get(
              { host: '127.0.0.1', port: address.port, path: `/${index}`, timeout: 5000 },
              (response) => {
                const chunks: Buffer[] = []
                response.on('data', (chunk: Buffer) => chunks.push(chunk))
                response.on('end', () =>
                  resolve({
                    status: response.statusCode ?? 0,
                    headers: response.headers,
                    body: Buffer.concat(chunks).toString('utf8'),
                  })
                )
                response.on('error', reject)
              }
            )
            request.on('timeout', () => request.destroy(new Error('Request timed out')))
            request.on('error', reject)
          })
          if (status !== 200 || body !== entry.body)
            throw new Error(`Unexpected response: ${status} ${JSON.stringify(body)}`)
          for (const [name, value] of Object.entries(entry.expected))
            if (headers[name] !== value)
              throw new Error(`Expected ${name} ${value}, got ${String(headers[name])}`)
          for (const name of entry.forbidden ?? [])
            if (headers[name] !== undefined)
              throw new Error(`Stale ${name} was forwarded: ${String(headers[name])}`)
          if (
            entry.headers['Transfer-Encoding'] &&
            headers['transfer-encoding'] === 'gzip, chunked'
          )
            throw new Error('The declared transfer coding was forwarded')
        } catch (caught) {
          error = getErrorMessage(caught)
        }
        checks.push({
          name: `${sender.name}: ${entry.name}`,
          status: error ? 'failed' : 'passed',
          durationMs: Math.round(performance.now() - started),
          ...(error ? { error } : {}),
        })
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    }
  }
} catch (error) {
  checks.push({
    name: 'Header suite lifecycle',
    status: 'failed',
    durationMs: Math.round(performance.now() - suiteStarted),
    error: getErrorMessage(error),
  })
} finally {
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify({ checks }, null, 2)}\n`)
}

const failures = checks.filter((check) => check.status === 'failed')
if (failures.length) {
  logger.error('Native header regression checks failed', { failures })
  process.exitCode = 1
} else logger.info('Native header regression checks passed', { checks: checks.length })
