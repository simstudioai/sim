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
import { POLL_INTERVAL_MS } from '@/tools/enrow/poll'
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

function jsonResponse(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
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

/** `MAX_POLL_TIME_MS / POLL_INTERVAL_MS` in `poll.ts` — 120_000 / 3_000. */
const MAX_POLLS = 40

describe('enrow_find_email', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('retries a transient 5xx instead of aborting the whole poll', async () => {
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
  })

  it('still absorbs a 429, which Enrow documents as impossible on a GET poll', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, { message: 'Too Many Requests' }))
      .mockResolvedValueOnce(jsonResponse(200, DOCUMENTED_FIND_BODY))
    vi.stubGlobal('fetch', fetchMock)

    const result = await enrowFindEmailTool.postProcess!(
      submittedFindResult,
      findParams,
      executeTool
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.output.qualification).toBe('valid')
  })

  it('escalates the retry delay and ignores an undocumented Retry-After header', async () => {
    const throttled = () =>
      jsonResponse(503, { message: 'upstream unavailable' }, { 'retry-after': '5' })
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(throttled())
      .mockResolvedValueOnce(throttled())
      .mockResolvedValueOnce(throttled())
      .mockResolvedValueOnce(jsonResponse(200, DOCUMENTED_FIND_BODY))
    vi.stubGlobal('fetch', fetchMock)

    await enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)

    const delays = vi.mocked(sleep).mock.calls.map(([ms]) => ms as number)

    expect(delays).toHaveLength(4)
    expect(delays[0]).toBe(POLL_INTERVAL_MS)

    // 3000 * 2 ** (attempt - 1) with the shared +/-20% jitter. Enrow documents
    // that error responses carry no retry hint, so a `Retry-After: 5` header
    // must not flatten this curve to a flat 5,000 ms.
    for (const [attempt, delay] of [delays[1], delays[2], delays[3]].entries()) {
      const exponential = POLL_INTERVAL_MS * 2 ** attempt
      expect(delay, `attempt ${attempt + 1} delay`).toBeGreaterThanOrEqual(exponential * 0.8)
      expect(delay, `attempt ${attempt + 1} delay`).toBeLessThan(exponential * 1.2)
    }
  })

  it('gives up on a persistent 500 — an expired search id must surface, not loop', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(500, { message: 'unknown search id' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      enrowFindEmailTool.postProcess!(submittedFindResult, findParams, executeTool)
    ).rejects.toThrow(/poll error: 500 - .*unknown search id/)

    // 3 bounded retries, then the 4th attempt surfaces the upstream failure.
    expect(fetchMock).toHaveBeenCalledTimes(4)
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
