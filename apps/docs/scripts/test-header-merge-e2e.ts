import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toRecord } from '@sim/utils/object'
import { patchSetHeaderWithCookieSupport } from 'next/dist/server/lib/patch-set-header'
import { addRequestMeta } from 'next/dist/server/request-meta'

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

const require = createRequire(import.meta.url)
const esmPath = require.resolve('next/dist/esm/server/lib/patch-set-header.js')
const imported: unknown = await import(pathToFileURL(esmPath).href)
const esmPatch = toRecord(imported).patchSetHeaderWithCookieSupport
if (typeof esmPatch !== 'function') throw new Error('The ESM header merger is unavailable')

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
