import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

const logger = createLogger('DocsLlmsFullE2E')
const origin = process.env.DOCS_E2E_BASE_URL
const reportPath = process.env.DOCS_LLMS_REPORT_PATH
if (!origin || !reportPath) {
  throw new Error('DOCS_E2E_BASE_URL and DOCS_LLMS_REPORT_PATH are required')
}
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) {
  throw new Error('The documentation server must use a loopback origin')
}

interface CheckResult {
  path: string
  status: 'passed' | 'failed'
  durationMs: number
  error?: string
}

const checks: CheckResult[] = []
try {
  const response = await fetch(new URL('/llms-full.txt', origin), {
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error(`Full documentation returned ${response.status}`)
  const text = await response.text()
  const starts = [...text.matchAll(/^# .+ \((\/[^\n]*)\)\n\n/gm)]
  const files = await readdir('content/docs', { recursive: true })
  const pageCount = files.filter((file) => /\.mdx?$/.test(file)).length
  if (starts.length !== pageCount) {
    throw new Error(`Expected ${pageCount} authored pages; found ${starts.length}`)
  }
  const seen = new Set<string>()
  for (let index = 0; index < starts.length; index += 1) {
    const match = starts[index]
    if (!match) continue
    const pagePath = match[1]
    if (!pagePath || seen.has(pagePath)) throw new Error(`Duplicate or missing path: ${pagePath}`)
    seen.add(pagePath)
    const started = performance.now()
    const check: CheckResult = { path: pagePath, status: 'failed', durationMs: 0 }
    try {
      const pageResponse = await fetch(new URL(`/llms.mdx${pagePath}`, origin), {
        signal: AbortSignal.timeout(10000),
      })
      if (!pageResponse.ok) throw new Error(`Markdown page returned ${pageResponse.status}`)
      const actual = await pageResponse.text()
      const end = starts[index + 1]?.index
      const expected = text.slice(match.index, end).replace(/\n\n---\n\n$/, '')
      if (actual !== expected)
        throw new Error('Bundled text differs from the rendered Markdown page')
      check.status = 'passed'
    } catch (error) {
      check.error = getErrorMessage(error)
    }
    check.durationMs = Math.round(performance.now() - started)
    checks.push(check)
  }
} catch (error) {
  checks.push({
    path: '/llms-full.txt',
    status: 'failed',
    durationMs: 0,
    error: getErrorMessage(error),
  })
}

await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify({ checks }, null, 2)}\n`)
const failures = checks.filter((check) => check.status === 'failed')
if (failures.length) {
  logger.error('Full documentation parity failed', { failures })
  process.exitCode = 1
} else {
  logger.info('Full documentation matches every authored Markdown page', { pages: checks.length })
}
