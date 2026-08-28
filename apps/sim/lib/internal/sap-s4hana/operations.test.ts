/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCallOdata, mockFetchAccessToken, mockFetchCsrf } = vi.hoisted(() => ({
  mockCallOdata: vi.fn(),
  mockFetchAccessToken: vi.fn(),
  mockFetchCsrf: vi.fn(),
}))

vi.mock('@/lib/internal/sap-s4hana/client', () => ({
  callSapOdata: mockCallOdata,
  fetchSapAccessToken: mockFetchAccessToken,
  fetchSapCsrf: mockFetchCsrf,
  isSapWriteMethod: (method: string) =>
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE' ||
    method === 'MERGE',
}))

import {
  executeSapS4HanaOperation,
  SapS4HanaProviderError,
} from '@/lib/internal/sap-s4hana/operations'
import { sapS4HanaOperationInputSchema } from '@/lib/internal/sap-s4hana/schema'

const BASE_INPUT = sapS4HanaOperationInputSchema.parse({
  deploymentType: 'cloud_private',
  authType: 'basic',
  baseUrl: 'https://sap.example.com',
  username: 'user',
  password: 'password',
  service: 'API_BUSINESS_PARTNER',
  path: '/A_BusinessPartner',
  method: 'GET',
})

describe('SAP S/4HANA operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFetchAccessToken.mockResolvedValue('token')
    mockFetchCsrf.mockResolvedValue({ token: 'csrf', cookie: 'session=1' })
  })

  it('preserves OData collection metadata while unwrapping the v2 envelope', async () => {
    mockCallOdata.mockResolvedValue({
      status: 200,
      body: { d: { results: [{ BusinessPartner: '100' }], __count: '1', __next: '/next' } },
      csrfHeader: '',
    })

    await expect(executeSapS4HanaOperation(BASE_INPUT, 'request-1')).resolves.toEqual({
      status: 200,
      data: {
        results: [{ BusinessPartner: '100' }],
        __count: '1',
        __next: '/next',
      },
    })
  })

  it('refreshes a rejected CSRF token once without workflow-level retries', async () => {
    mockCallOdata
      .mockResolvedValueOnce({
        status: 403,
        body: { error: { message: { value: 'CSRF token validation failed' } } },
        csrfHeader: 'required',
      })
      .mockResolvedValueOnce({ status: 204, body: null, csrfHeader: '' })

    await expect(
      executeSapS4HanaOperation(
        { ...BASE_INPUT, method: 'MERGE', body: { Name: 'Updated' } },
        'request-2'
      )
    ).resolves.toEqual({ status: 204, data: null })
    expect(mockFetchCsrf).toHaveBeenCalledTimes(2)
    expect(mockCallOdata).toHaveBeenCalledTimes(2)
  })

  it('preserves provider status and detailed OData errors', async () => {
    mockCallOdata.mockResolvedValue({
      status: 400,
      body: {
        error: {
          code: 'SAP/INVALID',
          message: { value: 'Invalid request' },
          innererror: {
            errordetails: [{ code: 'FIELD', message: 'Field is required', severity: 'error' }],
          },
        },
      },
      csrfHeader: '',
    })

    await expect(executeSapS4HanaOperation(BASE_INPUT, 'request-3')).rejects.toEqual(
      new SapS4HanaProviderError('[SAP/INVALID] Invalid request ([FIELD] Field is required)', 400)
    )
  })
})
