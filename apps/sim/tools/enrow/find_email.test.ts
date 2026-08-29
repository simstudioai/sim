/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Only `sleep` is stubbed because it is the sole `@sim/utils/helpers` export the
 * enrow tools import. `vi.importActual` is banned by CLAUDE.md, so the module is
 * replaced wholesale; if an enrow tool ever imports another helper the import
 * will be `undefined` and these tests fail loudly rather than silently.
 */
vi.mock('@sim/utils/helpers', () => ({ sleep: vi.fn().mockResolvedValue(undefined) }))

import { sleep } from '@sim/utils/helpers'
import { enrowFindEmailTool } from '@/tools/enrow/find_email'
import type {
  EnrowFindEmailParams,
  EnrowFindEmailResponse,
  EnrowVerifyEmailParams,
  EnrowVerifyEmailResponse,
} from '@/tools/enrow/types'
import { enrowVerifyEmailTool } from '@/tools/enrow/verify_email'
import type { ToolResponse } from '@/tools/types'

const JOB_ID = 'job-123'

/** `postProcess`'s third argument — never invoked by these polling tools. */
const executeTool = async (): Promise<ToolResponse> => {
  throw new Error('executeTool should not be called')
}

/** Verbatim documented 200 body for `GET /email/find/single`. */
const DOCUMENTED_FIND_BODY = {
  email: 'john.doe@stripe.com',
  qualification: 'valid',
  info: {
    company_domain: 'stripe.com',
    company_name: 'Stripe',
    fullname: 'John Doe',
    firstname: 'John',
    lastname: 'Doe',
  },
  custom: {},
}

/** Records `body.cancel()` so the tests can prove an abandoned stream is released. */
function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  const cancel = vi.fn().mockResolvedValue(undefined)
  cancelledBodies.push(cancel)
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    body: { cancel } as unknown as ReadableStream<Uint8Array>,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
}

/** Every `body.cancel` spy handed out by `jsonResponse`, in creation order. */
let cancelledBodies: Array<ReturnType<typeof vi.fn>> = []

/** The delays the tool actually asked `sleep` for, in order. */
function sleepDelays(): number[] {
  return vi.mocked(sleep).mock.calls.map((call) => call[0] as number)
}

const findParams: EnrowFindEmailParams = {
  apiKey: 'test-key',
  fullname: 'John Doe',
  company_domain: 'stripe.com',
}

const submittedFindResult: EnrowFindEmailResponse = {
  success: true,
  output: {
    id: JOB_ID,
    email: null,
    qualification: null,
    fullname: null,
    firstname: null,
    lastname: null,
    company_name: null,
    company_domain: null,
  },
}

/** `POLL_INTERVAL_MS` in `poll.ts`. */
const POLL_INTERVAL_MS = 3000

/** `MAX_POLL_TIME_MS` in `poll.ts`. */
const MAX_POLL_TIME_MS = 120_000

/** `MAX_POLL_TIME_MS / POLL_INTERVAL_MS`. */
const MAX_POLLS = MAX_POLL_TIME_MS / POLL_INTERVAL_MS

/** `MAX_TRANSIENT_RETRIES` in `poll.ts`. */
const MAX_TRANSIENT_RETRIES = 3

describe('enrow_find_email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    cancelledBodies = []
    vi.mocked(sleep).mockImplementation(async () => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps the documented nested `info` payload onto the flat output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, DOCUMENTED_FIND_BODY))
    vi.stubGlobal('fetch', fetchMock)

    const result = await enrowFindEmailTool.postProcess!(
      submittedFindResult,
      findParams,
      executeTool
    )

    expect(result.success).toBe(true)
    expect(result.output).toEqual({
      id: JOB_ID,
      email: 'john.doe@stripe.com',
      qualification: 'valid',
      fullname: 'John Doe',
      firstname: 'John',
      lastname: 'Doe',
      company_name: 'Stripe',
      company_domain: 'stripe.com',
    })
    expect('linkedin_url' in result.output).toBe(false)
  })

  it('keeps polling on a 202 in-progress body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(202, { qualification: 'ongoing' }))
      .mockResolvedValueOnce(jsonResponse(200, DOCUMENTED_FIND_BODY))
    vi.stubGlobal('fetch', fetchMock)

    const result = await enrowFindEmailTool.postProcess!(
      submittedFindResult,
      findParams,
      executeTool
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.output.email).toBe('john.doe@stripe.com')
    expect(result.output.firstname).toBe('John')
  })

  it('throws with the status and body when a poll returns a non-2xx status', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(202, { qualification: 'ongoing' }))
      .mockResolvedValueOnce(jsonResponse(401, { message: 'invalid api key' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)
    ).rejects.toThrow(/poll error: 401 - .*invalid api key/)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('backs off exponentially after a transient 5xx, then resolves', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(202, { qualification: 'ongoing' }))
      .mockResolvedValueOnce(jsonResponse(503, { message: 'upstream unavailable' }))
      .mockResolvedValueOnce(jsonResponse(200, DOCUMENTED_FIND_BODY))
    vi.stubGlobal('fetch', fetchMock)

    const result = await enrowFindEmailTool.postProcess!(
      submittedFindResult,
      findParams,
      executeTool
    )

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.output.email).toBe('john.doe@stripe.com')

    // Three poll intervals plus one backoff, which is attempt 1 off the 1000ms
    // base with +/-20% jitter — and notably not another 3000ms poll interval.
    const delays = sleepDelays()
    expect(delays).toHaveLength(4)
    expect([delays[0], delays[1], delays[3]]).toEqual([
      POLL_INTERVAL_MS,
      POLL_INTERVAL_MS,
      POLL_INTERVAL_MS,
    ])
    expect(delays[2]).toBeGreaterThanOrEqual(800)
    expect(delays[2]).toBeLessThanOrEqual(1200)
  })

  it('waits exactly the Retry-After delay on a 429 instead of its own backoff', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: 'slow down' }, { 'retry-after': '2' }))
      .mockResolvedValueOnce(jsonResponse(200, DOCUMENTED_FIND_BODY))
    vi.stubGlobal('fetch', fetchMock)

    const result = await enrowFindEmailTool.postProcess!(
      submittedFindResult,
      findParams,
      executeTool
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.output.qualification).toBe('valid')

    // `Retry-After: 2` is honoured verbatim (2000ms, no jitter), not replaced by
    // the 1000ms exponential base the 5xx path would have produced.
    expect(sleepDelays()).toEqual([POLL_INTERVAL_MS, 2000, POLL_INTERVAL_MS])
  })

  it('releases the body of every response it abandons', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(202, { qualification: 'ongoing' }))
      .mockResolvedValueOnce(jsonResponse(503, { message: 'upstream unavailable' }))
      .mockResolvedValueOnce(jsonResponse(200, DOCUMENTED_FIND_BODY))
    vi.stubGlobal('fetch', fetchMock)

    await enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)

    const [inProgress, transient, completed] = cancelledBodies
    expect(inProgress).toHaveBeenCalledTimes(1)
    expect(transient).toHaveBeenCalledTimes(1)
    expect(completed).not.toHaveBeenCalled()
  })

  it('bounds every poll request with an abort signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, DOCUMENTED_FIND_BODY))
    vi.stubGlobal('fetch', fetchMock)

    await enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.enrow.io/email/find/single?id=job-123',
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it('reports the polling window when a request is aborted at the deadline', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)
    ).rejects.toThrow('Enrow find-email did not complete within the polling window')

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rethrows a genuine transport failure rather than calling it a timeout', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)
    ).rejects.toThrow('fetch failed')
  })

  it('never sleeps past the wall-clock deadline when the polls themselves are slow', async () => {
    // `elapsed` charges nothing for time spent inside `fetch`, so with slow polls
    // the real clock runs ahead of it. A backoff sized against `elapsed` alone
    // lands well past the deadline; it has to be clamped to the real remainder.
    let now = Date.now()
    const deadline = now + MAX_POLL_TIME_MS
    const sleepStarts: number[] = []

    vi.spyOn(Date, 'now').mockImplementation(() => now)
    vi.mocked(sleep).mockImplementation(async (ms: number) => {
      sleepStarts.push(now)
      now += ms
    })

    const fetchMock = vi.fn().mockImplementation(async () => {
      now += 55_000
      return jsonResponse(500, { message: 'boom' }, { 'retry-after': '15' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)
    ).rejects.toThrow('Enrow find-email did not complete within the polling window')

    // Second poll ends past the deadline, so its 15s backoff must be dropped to
    // zero rather than clamped against the 99s that `elapsed` still thinks it has.
    expect(sleepDelays()).toEqual([POLL_INTERVAL_MS, 15_000, POLL_INTERVAL_MS])
    expect(sleepStarts.every((startedAt) => startedAt < deadline)).toBe(true)
  })

  it('waits out the whole window when a late backoff would overrun it', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => {
      // 38 in-progress polls, then a transient failure asking for far more time
      // than the window has left. The wait must be clipped to the remainder, not
      // skipped — skipping it abandons a live job before the window is spent.
      const call = fetchMock.mock.calls.length
      return call <= 38
        ? jsonResponse(202, { qualification: 'ongoing' })
        : jsonResponse(500, { message: 'boom' }, { 'retry-after': '60' })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)
    ).rejects.toThrow('Enrow find-email did not complete within the polling window')

    expect(fetchMock).toHaveBeenCalledTimes(39)
    const total = sleepDelays().reduce((sum, delay) => sum + delay, 0)
    expect(total).toBe(MAX_POLL_TIME_MS)
    expect(sleepDelays().at(-1)).toBe(MAX_POLL_TIME_MS - 39 * POLL_INTERVAL_MS)
  })

  it('gives up after a bounded number of transient failures', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: 'boom' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)
    ).rejects.toThrow(/poll error: 500 - .*boom/)

    expect(fetchMock).toHaveBeenCalledTimes(MAX_TRANSIENT_RETRIES + 1)
  })

  it('never retries a non-transient 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(403, { message: 'forbidden' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)
    ).rejects.toThrow(/poll error: 403 - .*forbidden/)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('gives up after the polling window when every poll stays 202', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, { qualification: 'ongoing' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)
    ).rejects.toThrow('Enrow find-email did not complete within the polling window')

    expect(fetchMock).toHaveBeenCalledTimes(MAX_POLLS)
  })
})

describe('enrow_verify_email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    cancelledBodies = []
    vi.mocked(sleep).mockImplementation(async () => undefined)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retries a transient 5xx on the verify poll too', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(502, { message: 'bad gateway' }))
      .mockResolvedValueOnce(
        jsonResponse(200, { email: 'john.doe@stripe.com', qualification: 'valid' })
      )
    vi.stubGlobal('fetch', fetchMock)

    const submitted: EnrowVerifyEmailResponse = {
      success: true,
      output: { id: JOB_ID, email: null, qualification: null },
    }
    const params: EnrowVerifyEmailParams = { apiKey: 'test-key', email: 'john.doe@stripe.com' }

    const result = await enrowVerifyEmailTool.postProcess!(submitted, params, executeTool)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.output.qualification).toBe('valid')
  })

  it('reads the FLAT documented verify body — there is no `info` level here', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(200, { email: 'john.doe@stripe.com', qualification: 'valid' })
      )
    vi.stubGlobal('fetch', fetchMock)

    const submitted: EnrowVerifyEmailResponse = {
      success: true,
      output: { id: JOB_ID, email: null, qualification: null },
    }
    const params: EnrowVerifyEmailParams = { apiKey: 'test-key', email: 'john.doe@stripe.com' }

    const result = await enrowVerifyEmailTool.postProcess!(submitted, params, executeTool)

    expect(result.output).toEqual({
      id: JOB_ID,
      email: 'john.doe@stripe.com',
      qualification: 'valid',
    })
  })
})
