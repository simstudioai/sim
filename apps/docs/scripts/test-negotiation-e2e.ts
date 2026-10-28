import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'

const logger = createLogger('DocsNegotiationE2E')
const origin = process.env.DOCS_E2E_BASE_URL
const reportPath = process.env.DOCS_NEGOTIATION_REPORT_PATH
if (!origin || !reportPath) {
  throw new Error('DOCS_E2E_BASE_URL and DOCS_NEGOTIATION_REPORT_PATH are required')
}
const url = new URL('/introduction', origin)
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
  throw new Error('The documentation server must use a loopback origin')
}

interface CheckResult {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  contentType?: string
  vary?: string
  error?: string
}

const cases = [
  { name: 'HTML advertises its representation and router cache dimensions', accept: 'text/html' },
  { name: 'Markdown negotiates at the same URL', accept: 'text/markdown' },
  { name: 'HTML remains available after a Markdown request', accept: 'text/html' },
] as const

for (let attempt = 0; attempt < 20; attempt += 1) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) })
    await response.body?.cancel()
    if (response.ok) break
  } catch {}
  await sleep(250)
}

const checks: CheckResult[] = []
for (const entry of cases) {
  const started = performance.now()
  const result: CheckResult = { name: entry.name, status: 'failed', durationMs: 0 }
  try {
    const response = await fetch(url, {
      headers: { Accept: entry.accept },
      signal: AbortSignal.timeout(10000),
    })
    await response.body?.cancel()
    result.contentType = response.headers.get('Content-Type') ?? ''
    result.vary = response.headers.get('Vary') ?? ''
    const fields = result.vary.split(',').map((field) => field.trim().toLowerCase())
    if (!response.ok) throw new Error(`Unexpected HTTP status ${response.status}`)
    if (!result.contentType.startsWith(entry.accept)) {
      throw new Error(`Expected ${entry.accept}; received ${result.contentType}`)
    }
    if (!fields.includes('accept')) throw new Error('The response lost Vary: Accept')
    if (entry.accept === 'text/html') {
      for (const field of [
        'rsc',
        'next-router-state-tree',
        'next-router-prefetch',
        'next-router-segment-prefetch',
      ]) {
        if (!fields.includes(field)) throw new Error(`The response lost Vary: ${field}`)
      }
    }
    if (fields.length !== new Set(fields).size) throw new Error('Vary contains duplicate fields')
    result.status = 'passed'
  } catch (error) {
    result.error = getErrorMessage(error)
  }
  result.durationMs = Math.round(performance.now() - started)
  checks.push(result)
}

await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify({ checks }, null, 2)}\n`)
const failures = checks.filter((check) => check.status === 'failed')
if (failures.length) {
  logger.error('Documentation negotiation failed', { failures })
  process.exitCode = 1
} else {
  logger.info('Documentation negotiation passed', { checks: checks.length })
}
