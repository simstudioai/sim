/**
 * @vitest-environment node
 */
import {
  createMockRequest,
  hybridAuthMockFns,
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { POST } from '@/app/api/tools/agiloft/nlp_search/route'

/** Obvious non-secret so credential scanners do not flag these fixtures. */
const PLACEHOLDER_PASSWORD = 'not-a-real-password'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  instanceUrl: 'https://example.agiloft.com',
  knowledgeBase: 'Contract Templates',
  login: 'svc.user',
  password: PLACEHOLDER_PASSWORD,
  nlpQuery: 'Active NDAs submitted last month',
  fields: 'id, contract_title1',
}

function res(body: { ok?: boolean; status?: number; json?: unknown; text?: string }) {
  const text = body.text ?? JSON.stringify(body.json ?? {})
  return {
    ok: body.ok ?? true,
    status: body.status ?? 200,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: async () => text,
    json: async () => JSON.parse(text),
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  hybridAuthMockFns.mockCheckInternalAuth.mockResolvedValue({
    success: true,
    userId: 'user-1',
    authType: 'internal_jwt',
  })
  inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
    isValid: true,
    resolvedIP: PINNED_IP,
    originalHostname: 'example.agiloft.com',
  })
})

/** Envelope shape Agiloft documents for this endpoint. */
const RECORDS_OK = res({
  json: {
    success: true,
    message: '',
    result: [
      { id: 31, contract_title1: 'EXAMPLE_TITLE' },
      { id: 32, contract_title1: 'MASTER SERVICES AGREEMENT' },
    ],
  },
})

describe('EWNLPSearch request', () => {
  it('authenticates inline with a form body and no login round trip', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(RECORDS_OK)

    await POST(createMockRequest('POST', baseBody))

    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)

    const [url, ip, init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(url).toBe('https://example.agiloft.com/ewws/EWNLPSearch')
    expect(ip).toBe(PINNED_IP)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded')
  })

  /**
   * The credentials are request parameters. Sending them as members of a JSON
   * payload is what makes Agiloft answer "One has to specify $login, $password
   * parameters" and fail every call.
   */
  it('sends the credentials as request parameters, not as payload keys', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(RECORDS_OK)

    await POST(createMockRequest('POST', baseBody))

    const [url, , init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
    const sent = new URLSearchParams(init.body as string)

    expect(sent.get('$KB')).toBe('Contract Templates')
    expect(sent.get('$login')).toBe('svc.user')
    expect(sent.get('$password')).toBe(PLACEHOLDER_PASSWORD)
    expect(sent.get('$lang')).toBe('en')
    expect(() => JSON.parse(init.body as string)).toThrow()
    // The password must never reach the URL, where it would land in access logs.
    expect(url).not.toContain(PLACEHOLDER_PASSWORD)
  })

  it('sends the query and repeats field once per requested field', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(RECORDS_OK)

    await POST(createMockRequest('POST', baseBody))

    const [, , init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
    const sent = new URLSearchParams(init.body as string)

    expect(sent.get('nlp_query')).toBe('Active NDAs submitted last month')
    expect(sent.getAll('field')).toEqual(['id', 'contract_title1'])
  })

  it('forwards pagination, which is the only bound on a knowledge-base-wide search', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(RECORDS_OK)

    await POST(createMockRequest('POST', { ...baseBody, page: '2', limit: '25' }))

    const [, , init] = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
    const sent = new URLSearchParams(init.body as string)

    expect(sent.get('page')).toBe('2')
    expect(sent.get('limit')).toBe('25')
  })
})

describe('EWNLPSearch response', () => {
  it('maps the documented envelope onto records and totalCount', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(RECORDS_OK)

    const response = await POST(createMockRequest('POST', baseBody))
    const data = (await response.json()) as {
      success: boolean
      output: { records: unknown[]; totalCount: number; truncated: boolean }
    }

    expect(data.success).toBe(true)
    expect(data.output.records).toHaveLength(2)
    expect(data.output.totalCount).toBe(2)
    expect(data.output.truncated).toBe(false)
  })

  it('surfaces the authentication refusal instead of reporting an empty result set', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({
        ok: false,
        status: 400,
        text: '<html><body>EWWrongDataException has occurred: One has to specify $login, $password parameters</body></html>',
      })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    const data = (await response.json()) as { success: boolean; error?: string }

    expect(data.success).toBe(false)
    expect(data.error).toContain('One has to specify $login, $password')
  })

  it('reports a search that matched nothing as an empty success, not a failure', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({ json: { success: true, message: '', result: [] } })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    const data = (await response.json()) as {
      success: boolean
      output: { records: unknown[]; totalCount: number; truncated: boolean }
    }

    expect(data.success).toBe(true)
    expect(data.output).toEqual({ records: [], totalCount: 0, truncated: false })
  })

  it('caps the records it returns and reports the result as truncated', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      res({
        json: {
          success: true,
          result: Array.from({ length: 250 }, (_, index) => ({ id: index })),
        },
      })
    )

    const response = await POST(createMockRequest('POST', baseBody))
    const data = (await response.json()) as {
      output: { records: unknown[]; totalCount: number; truncated: boolean }
    }

    expect(data.output.records).toHaveLength(200)
    expect(data.output.totalCount).toBe(200)
    expect(data.output.truncated).toBe(true)
  })
})
