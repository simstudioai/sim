import { authInternalMock, authInternalMockFns } from '@sim/testing/mocks/auth-internal.mock'
import { resetUrlsMock, urlsMockFns } from '@sim/testing/mocks/urls.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/internal', () => authInternalMock)

import {
  BINARY_CONTENT_REDACTED_MARKER,
  PiiRedactionError,
  REDACTION_FAILED_MARKER,
  redactObjectStrings,
  redactPIIFromExecution,
} from '@/lib/logs/execution/pii-redaction'

afterAll(resetUrlsMock)

/** The mask-batch route, stubbed at `fetch`: echoes each string as `MASKED(<text>)`. */
let maskRoute: ReturnType<typeof vi.fn>

/** Every string sent to the route, in request order. */
function sentTexts(): string[] {
  return maskRoute.mock.calls.flatMap(([, init]) => JSON.parse(init.body).texts as string[])
}

beforeEach(() => {
  authInternalMockFns.mockGenerateInternalToken.mockResolvedValue('tok')
  urlsMockFns.mockGetInternalApiBaseUrl.mockReturnValue('http://app.internal:3000')
  maskRoute = vi.fn(async (_url: string, init: { body: string }) => {
    const { texts } = JSON.parse(init.body) as { texts: string[] }
    return Response.json({ masked: texts.map((t) => `MASKED(${t})`) })
  })
  vi.stubGlobal('fetch', maskRoute)
})

/** A response the route gives for input Presidio rejected: not retried. */
const rejected = () => new Response('rejected', { status: 422 })

describe('redactPIIFromExecution', () => {
  it('collects and masks string leaves recursively, preserving structure', async () => {
    const payload = {
      traceSpans: [
        {
          blockId: 'b1',
          status: 'success',
          input: { email: 'a@b.com' },
          output: { text: 'hello' },
          children: [{ blockId: 'c1', output: { nested: 'deep' } }],
        },
      ],
      finalOutput: { answer: 'world' },
      workflowInput: 'start',
    }

    const result = await redactPIIFromExecution(payload, { entityTypes: ['EMAIL_ADDRESS'] })

    const span = (result.traceSpans as any[])[0]
    expect(span.blockId).toBe('b1')
    expect(span.status).toBe('success')
    expect(span.input.email).toBe('MASKED(a@b.com)')
    expect(span.output.text).toBe('MASKED(hello)')
    expect(span.children[0].output.nested).toBe('MASKED(deep)')
    expect((result.finalOutput as any).answer).toBe('MASKED(world)')
    expect(result.workflowInput).toBe('MASKED(start)')
    expect(maskRoute).toHaveBeenCalledTimes(1)
    expect(sentTexts()).toEqual(['a@b.com', 'hello', 'deep', 'world', 'start'])
  })

  it('scrubs all eligible strings when masking throws (no leak)', async () => {
    urlsMockFns.mockGetInternalApiBaseUrl.mockImplementationOnce(() => {
      throw new Error('no internal base url')
    })
    const payload = {
      traceSpans: [{ output: { text: 'secret@x.com' } }],
      finalOutput: 'another secret',
    }

    const result = await redactPIIFromExecution(payload, { entityTypes: [] })

    expect((result.traceSpans as any[])[0].output.text).toBe(REDACTION_FAILED_MARKER)
    expect(result.finalOutput).toBe(REDACTION_FAILED_MARKER)
  })

  it('scrubs only the strings of a request chunk that failed, masking the rest', async () => {
    // 2000 strings per request: the first chunk is rejected, the second is masked.
    const items = Array.from({ length: 2001 }, (_, i) => `item ${i}`)
    maskRoute.mockResolvedValueOnce(rejected())

    const result = await redactPIIFromExecution({ finalOutput: items }, { entityTypes: [] })

    const output = result.finalOutput as string[]
    expect(output.slice(0, 2000).every((value) => value === REDACTION_FAILED_MARKER)).toBe(true)
    expect(output[2000]).toBe('MASKED(item 2000)')
  })

  it('masks large strings too (never left unredacted)', async () => {
    const big = 'x'.repeat(200 * 1024)
    const payload = { finalOutput: { big, small: 'pii' } }

    const result = await redactPIIFromExecution(payload, { entityTypes: [] })

    expect((result.finalOutput as any).big).toBe(`MASKED(${big})`)
    expect((result.finalOutput as any).small).toBe('MASKED(pii)')
    expect(sentTexts()).toEqual([big, 'pii'])
  })

  it('masks span error/errorMessage and top-level error, trigger, executionState, environment', async () => {
    const payload = {
      traceSpans: [{ blockId: 'b1', error: 'failed for bob@x.com', errorMessage: 'bad input z' }],
      error: 'run failed: a@b.com',
      completionFailure: 'cancelled by c@d.com',
      trigger: { type: 'webhook', data: { from: 'caller@x.com' } },
      executionState: { status: 'completed', note: 'state for e@f.com' },
      environment: { variables: { CONTACT: 'admin@x.com' } },
      correlation: { source: 'corr@x.com' },
    }

    const result = await redactPIIFromExecution(payload, { entityTypes: ['EMAIL_ADDRESS'] })

    const span = (result.traceSpans as any[])[0]
    expect(span.blockId).toBe('b1')
    expect(span.error).toBe('MASKED(failed for bob@x.com)')
    expect(span.errorMessage).toBe('MASKED(bad input z)')
    expect(result.error).toBe('MASKED(run failed: a@b.com)')
    expect(result.completionFailure).toBe('MASKED(cancelled by c@d.com)')
    expect((result.trigger as any).type).toBe('MASKED(webhook)')
    expect((result.trigger as any).data.from).toBe('MASKED(caller@x.com)')
    expect((result.executionState as any).note).toBe('MASKED(state for e@f.com)')
    expect((result.environment as any).variables.CONTACT).toBe('MASKED(admin@x.com)')
    expect((result.correlation as any).source).toBe('MASKED(corr@x.com)')
  })
})

/** Base64 of 48KB of non-text bytes, the shape a file body takes in a payload. */
const encodedFile = Buffer.from(
  Array.from({ length: 48 * 1024 }, (_, i) => (i * 7919 + 13) % 256)
).toString('base64')

describe('encoded binary content', () => {
  it('replaces encoded file bodies in a persisted log without sending them to Presidio', async () => {
    const payload = {
      traceSpans: [{ blockId: 'write', input: { content: encodedFile, name: 'Ada Lovelace' } }],
      workflowInput: { file: `data:application/pdf;base64,${encodedFile}` },
    }

    const result = await redactPIIFromExecution(payload, { entityTypes: ['PERSON'] })

    const [span] = result.traceSpans as { input: { content: string; name: string } }[]
    expect(span.input.content).toBe(BINARY_CONTENT_REDACTED_MARKER)
    expect((result.workflowInput as { file: string }).file).toBe(BINARY_CONTENT_REDACTED_MARKER)
    expect(span.input.name).toBe('MASKED(Ada Lovelace)')
    expect(sentTexts()).toEqual(['Ada Lovelace'])
  })

  it('passes encoded file bodies through live data unchanged and unsent', async () => {
    const value = { content: encodedFile, url: `data:image/png;base64,${encodedFile}`, note: 'hi' }

    const result = await redactObjectStrings(value, { entityTypes: [], onFailure: 'throw' })

    expect(result.content).toBe(encodedFile)
    expect(result.url).toBe(`data:image/png;base64,${encodedFile}`)
    expect(result.note).toBe('MASKED(hi)')
    expect(sentTexts()).toEqual(['hi'])
  })

  /** `encodedFile` wrapped at `width` columns, as MIME (76) and PEM (64) encoders emit it. */
  const wrapped = (width: number, newline: string) =>
    (encodedFile.match(new RegExp(`.{1,${width}}`, 'g')) ?? []).join(newline)

  it.each([
    ['with a trailing newline', `${encodedFile}\n`],
    ['wrapped at 76 columns', wrapped(76, '\n')],
    ['wrapped at 64 columns with CRLF', `${wrapped(64, '\r\n')}\r\n`],
    ['as a wrapped data URL', `data:application/pdf;base64,${wrapped(76, '\n')}`],
  ])('replaces an encoded file body %s in a persisted log', async (_label, body) => {
    const result = await redactPIIFromExecution({ finalOutput: body }, { entityTypes: [] })

    expect(result.finalOutput).toBe(BINARY_CONTENT_REDACTED_MARKER)
    expect(sentTexts()).toEqual([])
  })

  it.each([
    ['a newline-separated list of usernames', 'AdaLovelace1815\n'.repeat(100)],
    ['a long run of digits', '4'.repeat(4096)],
    ['lowercase hex', 'deadbeef0123'.repeat(400)],
    ['a short base64 token', 'QWRhIExvdmVsYWNl'],
    ['a long space-separated sentence', 'Ada Lovelace wrote code. '.repeat(200)],
  ])('still masks %s, which is not an encoded file', async (_label, text) => {
    const result = await redactObjectStrings({ text }, { entityTypes: [], onFailure: 'throw' })

    expect(result.text).not.toBe(text)
    expect(sentTexts().join('')).toBe(text)
  })
})

describe('redactObjectStrings', () => {
  it('throws PiiRedactionError on masking failure when onFailure is throw', async () => {
    maskRoute.mockResolvedValueOnce(rejected())
    await expect(
      redactObjectStrings({ text: 'a@b.com' }, { entityTypes: [], onFailure: 'throw' })
    ).rejects.toBeInstanceOf(PiiRedactionError)
  })

  it('scrubs (does not throw) by default on failure', async () => {
    maskRoute.mockResolvedValueOnce(rejected())
    const result = await redactObjectStrings({ text: 'a@b.com' }, { entityTypes: [] })
    expect(result).toEqual({ text: REDACTION_FAILED_MARKER })
  })
})

describe('transformStrings (via redactObjectStrings) leaves large-value refs intact', () => {
  it('does not recurse into / corrupt a large-value ref while masking siblings', async () => {
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_abcdef123456',
      kind: 'object',
      size: 9_000_000,
    }
    const result = (await redactObjectStrings(
      { name: 'bob', big: ref },
      { entityTypes: ['PERSON'] }
    )) as any
    expect(result.name).toBe('MASKED(bob)')
    // The ref is left byte-for-byte intact (its key/id are not masked).
    expect(result.big).toEqual(ref)
  })
})
