import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

/**
 * Proves PII redaction of oversized and encoded content against a running local
 * app and a real Presidio container (`docker/pii.Dockerfile`, the app's `PII_URL`).
 * The redaction library runs in this process the way the log persist path runs in
 * a worker: every mask request crosses the app's `/api/guardrails/mask-batch` route
 * over HTTP, and the route calls Presidio, whose spaCy NER refuses texts over
 * 1,000,000 characters.
 *
 * Checks, each recorded in the report:
 * - Presidio answers an over-length NER text with a 422, not a 500, and still
 *   serves the same text when the request needs only pattern recognizers.
 * - A persisted log holding a 5M-character base64 PDF and a 3M-character text that
 *   names a person at the end: the PDF becomes the binary marker without reaching
 *   Presidio, the name is masked by real NER, and no request fails.
 * - The same content as live block output: the PDF passes through byte-identical
 *   and the name is masked.
 *
 * Exits non-zero when any check fails, after writing the report.
 */
const logger = createLogger('PiiRedactionE2E')

function requiredEnvironment(name: string): string {
  const value = process.env[name]
  assert(value, `${name} must be explicitly provided`)
  return value
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const baseUrl = new URL(requiredEnvironment('PII_E2E_BASE_URL'))
const presidioUrl = new URL(requiredEnvironment('PII_E2E_PRESIDIO_URL'))
const reportPath = requiredEnvironment('PII_E2E_REPORT_PATH')
assert(LOOPBACK_HOSTS.has(baseUrl.hostname), 'The app must use a loopback host')
assert(LOOPBACK_HOSTS.has(presidioUrl.hostname), 'Presidio must use a loopback host')
assert(
  requiredEnvironment('INTERNAL_API_SECRET').length >= 32,
  'INTERNAL_API_SECRET must match the running app'
)
process.env.INTERNAL_API_BASE_URL = baseUrl.origin

/** What a persisted log shows in place of an encoded file body. */
const BINARY_MARKER = '[BINARY_CONTENT_REDACTED]'
const FAILED_MARKER = '[REDACTION_FAILED]'
/** spaCy's default `max_length`, the per-text ceiling of one NER pass. */
const SPACY_MAX_LENGTH = 1_000_000
/** The longest text one mask request may carry once texts are split. */
const MAX_TEXT_CHARS = 1_000_000

/** 3.75MB of bytes behind a PDF header: 5,000,000 characters of base64. */
const pdfBase64 = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(3_750_000 - 9)]).toString(
  'base64'
)
const FILLER = 'The quarterly report covers revenue, costs, and the hiring plan.\n'
const NAME_SENTENCE = 'Please send questions to Ada Lovelace before Friday.'
const longText = `${FILLER.repeat(Math.ceil(3_000_000 / FILLER.length))}${NAME_SENTENCE}`

interface MaskRequest {
  status: number
  texts: number
  longestText: number
  totalChars: number
}

/** Every mask-batch request this process sends, observed at `fetch`, unmodified. */
const maskRequests: MaskRequest[] = []
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const response = await realFetch(input, init)
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (url.endsWith('/api/guardrails/mask-batch') && typeof init?.body === 'string') {
    const { texts } = JSON.parse(init.body) as { texts: string[] }
    maskRequests.push({
      status: response.status,
      texts: texts.length,
      longestText: Math.max(0, ...texts.map((text) => text.length)),
      totalChars: texts.reduce((sum, text) => sum + text.length, 0),
    })
  }
  return response
}) as typeof fetch

const checks: {
  name: string
  status: 'passed' | 'failed'
  durationMs: number
  details?: Record<string, unknown>
  error?: string
}[] = []

async function check(
  name: string,
  run: () => Promise<Record<string, unknown> | undefined>
): Promise<void> {
  const startedAt = performance.now()
  const requestsBefore = maskRequests.length
  try {
    const details = await run()
    checks.push({
      name,
      status: 'passed',
      durationMs: Math.round(performance.now() - startedAt),
      details: { ...details, maskRequests: maskRequests.slice(requestsBefore) },
    })
  } catch (error) {
    checks.push({
      name,
      status: 'failed',
      durationMs: Math.round(performance.now() - startedAt),
      details: { maskRequests: maskRequests.slice(requestsBefore) },
      error: getErrorMessage(error),
    })
  }
}

function assertMaskRequestsSucceeded(since: number, mustNotCarry: number): void {
  const requests = maskRequests.slice(since)
  assert(requests.length > 0, 'Expected mask-batch requests')
  for (const request of requests) {
    assert.equal(request.status, 200, `A mask-batch request answered ${request.status}`)
    assert(
      request.longestText <= MAX_TEXT_CHARS,
      `A mask-batch request carried a ${request.longestText}-character text`
    )
  }
  const sent = requests.reduce((sum, request) => sum + request.totalChars, 0)
  assert(sent < mustNotCarry, `Requests carried ${sent} characters, so the encoded file was sent`)
}

function assertNameMasked(masked: unknown): void {
  assert.equal(typeof masked, 'string', 'Expected the long text back as a string')
  const text = masked as string
  assert(!text.includes(FAILED_MARKER), 'The long text was scrubbed instead of masked')
  assert(!text.includes('Ada Lovelace'), 'The name at the end of the long text was not masked')
  assert(text.endsWith('before Friday.'), 'The end of the long text was lost')
  assert(text.includes('<PERSON>'), 'Expected a <PERSON> token where the name was')
}

async function main(): Promise<void> {
  const { redactObjectStrings, redactPIIFromExecution } = await import(
    '@/lib/logs/execution/pii-redaction'
  )

  await check('Presidio refuses an over-length NER text with a 422', async () => {
    const overLength = 'a '.repeat(SPACY_MAX_LENGTH / 2 + 1)
    const ner = await realFetch(new URL('/redact_batch', presidioUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: [overLength], language: 'en', entities: ['PERSON'] }),
    })
    const detail = await ner.text()
    assert.equal(ner.status, 422, `NER pass answered ${ner.status}: ${detail.slice(0, 200)}`)

    const patternsOnly = await realFetch(new URL('/redact_batch', presidioUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts: [overLength], language: 'en', entities: ['EMAIL_ADDRESS'] }),
    })
    assert.equal(patternsOnly.status, 200, 'A pattern-only pass must not be length-limited')
    return { nerStatus: ner.status, detail: detail.slice(0, 200), patternOnlyStatus: 200 }
  })

  await check('A persisted log replaces the PDF and masks the long text', async () => {
    const since = maskRequests.length
    const result = await redactPIIFromExecution(
      {
        traceSpans: [
          {
            blockId: 'write-file',
            input: { content: pdfBase64, name: 'datasheet.pdf' },
            output: { text: longText },
          },
        ],
        workflowInput: { file: `data:application/pdf;base64,${pdfBase64}` },
      },
      { entityTypes: ['PERSON'] }
    )
    const [span] = result.traceSpans as {
      input: { content: string }
      output: { text: string }
    }[]
    assert.equal(span.input.content, BINARY_MARKER)
    assert.equal((result.workflowInput as { file: string }).file, BINARY_MARKER)
    assertNameMasked(span.output.text)
    assertMaskRequestsSucceeded(since, pdfBase64.length)
    return { maskedTail: span.output.text.slice(-60) }
  })

  await check('Live block output keeps the PDF bytes and masks the long text', async () => {
    const since = maskRequests.length
    const result = await redactObjectStrings(
      { content: pdfBase64, text: longText },
      { entityTypes: ['PERSON'], onFailure: 'throw' }
    )
    assert.equal(result.content, pdfBase64, 'The encoded file changed')
    assertNameMasked(result.text)
    assertMaskRequestsSucceeded(since, pdfBase64.length)
    return { maskedTail: result.text.slice(-60) }
  })
}

const startedAt = new Date().toISOString()
try {
  await main()
} catch (error) {
  checks.push({ name: 'setup', status: 'failed', durationMs: 0, error: getErrorMessage(error) })
}
const failed = checks.filter((entry) => entry.status === 'failed')
const report = {
  suite: 'pii-redaction-e2e',
  startedAt,
  finishedAt: new Date().toISOString(),
  baseUrl: baseUrl.origin,
  presidioUrl: presidioUrl.origin,
  fixtures: { pdfBase64Chars: pdfBase64.length, longTextChars: longText.length },
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
for (const entry of checks) {
  logger.info('PII redaction check', {
    name: entry.name,
    status: entry.status,
    durationMs: entry.durationMs,
    error: entry.error,
  })
}
process.exit(failed.length === 0 ? 0 : 1)
