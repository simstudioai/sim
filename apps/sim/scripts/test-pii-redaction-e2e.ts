import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'

/**
 * Proves PII redaction of oversized and encoded content against a running local
 * app and a real Presidio container (`docker/pii.Dockerfile`, the app's `PII_URL`).
 * The redaction library runs in this process the way the log persist path runs in
 * a worker: every mask request crosses the app's `/api/guardrails/mask-batch` route
 * over HTTP, and the route calls Presidio, whose spaCy NER refuses any single text
 * over 1,000,000 characters.
 *
 * Checks, each recorded in the report:
 * - Presidio masks a text over spaCy's limit: a name straddling an NER window edge,
 *   a name at the very end, and a custom pattern that spans whitespace.
 * - A persisted log holding a 5M-character base64 PDF and a 3M-character text that
 *   names a person at the end: the PDF becomes the binary marker without reaching
 *   Presidio, the name is masked by real NER, and no request fails.
 * - The same content as live block output: nothing is exempt from masking, the
 *   run is not aborted, and the name is masked.
 *
 * Exits non-zero when any check fails, after writing the report.
 */
const logger = createLogger('PiiRedactionE2E')

const reportPath = process.env.PII_E2E_REPORT_PATH
if (!reportPath) throw new Error('PII_E2E_REPORT_PATH must be explicitly provided')

/** spaCy's default `max_length`, the per-text ceiling of one NER pass. */
const SPACY_MAX_LENGTH = 1_000_000
/** Where Presidio's first NER window ends (`NER_WINDOW_CHARS` in apps/pii/server.py). */
const FIRST_NER_WINDOW_END = 100_000

const FILLER = 'The quarterly report covers revenue, costs, and the hiring plan.\n'
const NAME_SENTENCE = 'Please send questions to Ada Lovelace before Friday.'

interface MaskRequest {
  status: number
  texts: number
  totalChars: number
}

/** Every mask-batch request this process sends, observed at `fetch`, unmodified. */
const maskRequests: MaskRequest[] = []

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

function assertMaskRequestsSucceeded(since: number): number {
  const requests = maskRequests.slice(since)
  assert(requests.length > 0, 'Expected mask-batch requests')
  for (const request of requests) {
    assert.equal(request.status, 200, `A mask-batch request answered ${request.status}`)
  }
  return requests.reduce((sum, request) => sum + request.totalChars, 0)
}

function assertNameMasked(masked: unknown, failedMarker: string): void {
  assert.equal(typeof masked, 'string', 'Expected the long text back as a string')
  const text = masked as string
  assert(!text.includes(failedMarker), 'The long text was scrubbed instead of masked')
  assert(
    text.endsWith('Please send questions to <PERSON> before Friday.'),
    'The name at the end of the long text was not masked as one <PERSON> span'
  )
}

async function main(): Promise<void> {
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  const baseUrl = new URL(process.env.PII_E2E_BASE_URL ?? '')
  const presidioUrl = new URL(process.env.PII_E2E_PRESIDIO_URL ?? '')
  assert(loopbackHosts.has(baseUrl.hostname), 'The app must use a loopback host')
  assert(loopbackHosts.has(presidioUrl.hostname), 'Presidio must use a loopback host')
  assert(
    (process.env.INTERNAL_API_SECRET ?? '').length >= 32,
    'INTERNAL_API_SECRET must match the running app'
  )
  process.env.INTERNAL_API_BASE_URL = baseUrl.origin

  const realFetch = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await realFetch(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.endsWith('/api/guardrails/mask-batch') && typeof init?.body === 'string') {
      const { texts } = JSON.parse(init.body) as { texts: string[] }
      maskRequests.push({
        status: response.status,
        texts: texts.length,
        totalChars: texts.reduce((sum, text) => sum + text.length, 0),
      })
    }
    return response
  }) as typeof fetch

  const {
    BINARY_CONTENT_REDACTED_MARKER,
    REDACTION_FAILED_MARKER,
    redactObjectStrings,
    redactPIIFromExecution,
  } = await import('@/lib/logs/execution/pii-redaction')

  /** 3.75MB of fixed non-text bytes behind a PDF header: 5,000,000 characters of base64. */
  const pdfHeader = Buffer.from('%PDF-1.7\n')
  const pdfBytes = Buffer.alloc(3_750_000)
  pdfHeader.copy(pdfBytes)
  for (let i = pdfHeader.length; i < pdfBytes.length; i++) pdfBytes[i] = (i * 7919 + 13) % 256
  const pdfBase64 = pdfBytes.toString('base64')
  const longText = `${FILLER.repeat(Math.ceil(3_000_000 / FILLER.length))}${NAME_SENTENCE}`

  await check('Presidio masks a text longer than one NER pass allows', async () => {
    const prose = (length: number) =>
      FILLER.repeat(Math.ceil(length / FILLER.length)).slice(0, length)
    const lead = 'Please send questions to '
    const text =
      prose(FIRST_NER_WINDOW_END - lead.length - 6) +
      `${lead}Grace Hopper before Friday.\n` +
      prose(400_000) +
      'badge EMP 123456 issued\n' +
      prose(SPACY_MAX_LENGTH) +
      NAME_SENTENCE
    const response = await realFetch(new URL('/redact_batch', presidioUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        texts: [text],
        language: 'en',
        entities: ['PERSON'],
        patterns: [{ regex: 'EMP\\s+\\d{6}', replacement: 'EMPLOYEE_ID', name: 'Employee ID' }],
      }),
    })
    const body = await response.text()
    assert.equal(
      response.status,
      200,
      `Presidio answered ${response.status}: ${body.slice(0, 200)}`
    )
    const [masked] = (JSON.parse(body) as { texts: string[] }).texts
    assert(
      masked.includes(`${lead}<PERSON> before Friday.`),
      'The name across the first NER window edge was not masked as one <PERSON> span'
    )
    assert(masked.endsWith('to <PERSON> before Friday.'), 'The name at the end survived')
    assert(!masked.includes('EMP 123456'), 'The custom pattern spanning whitespace survived')
    assert(masked.includes('<EMPLOYEE_ID>'), 'Expected the custom replacement')
    return { textChars: text.length }
  })

  await check('A persisted log replaces the PDF and masks the long text', async () => {
    const since = maskRequests.length
    const result = await redactPIIFromExecution(
      {
        traceSpans: [
          {
            blockId: 'write-file',
            input: { content: pdfBase64, name: 'report.pdf' },
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
    assert.equal(span.input.content, BINARY_CONTENT_REDACTED_MARKER)
    assert.equal((result.workflowInput as { file: string }).file, BINARY_CONTENT_REDACTED_MARKER)
    assertNameMasked(span.output.text, REDACTION_FAILED_MARKER)
    const sentChars = assertMaskRequestsSucceeded(since)
    assert(
      sentChars < pdfBase64.length,
      `Requests carried ${sentChars} characters: the PDF was sent`
    )
    return { sentChars, maskedTail: span.output.text.slice(-60) }
  })

  await check('Live block output is masked in full without aborting the run', async () => {
    const since = maskRequests.length
    const result = await redactObjectStrings(
      { content: pdfBase64, text: longText },
      { entityTypes: ['PERSON'], onFailure: 'throw' }
    )
    assertNameMasked(result.text, REDACTION_FAILED_MARKER)
    const sentChars = assertMaskRequestsSucceeded(since)
    assert(sentChars >= pdfBase64.length + longText.length, 'Live data skipped part of its masking')
    return {
      sentChars,
      pdfUnchanged: result.content === pdfBase64,
      maskedTail: result.text.slice(-60),
    }
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
