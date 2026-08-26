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

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
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

/** `MAX_POLL_TIME_MS / POLL_INTERVAL_MS` in `find_email.ts` — 120_000 / 3_000. */
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
