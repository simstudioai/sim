/**
 * @vitest-environment node
 */
import { resetUrlsMock, urlsMockFns } from '@sim/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGenerateInternalDelegationToken, mockGenerateInternalToken } = vi.hoisted(() => ({
  mockGenerateInternalDelegationToken: vi.fn(),
  mockGenerateInternalToken: vi.fn(),
}))

vi.mock('@/lib/auth/internal', () => ({
  generateInternalDelegationToken: mockGenerateInternalDelegationToken,
  generateInternalToken: mockGenerateInternalToken,
}))

import { executeTool } from '@/tools'
import { plaidGetItemTool } from '@/tools/plaid/get_item'
import { tools } from '@/tools/registry'
import type { ToolConfig } from '@/tools/types'

const PLAID_GET_ITEM_ID = 'plaid_get_item'
const INTERNAL_API_BASE_URL = 'http://sim.internal'
const TOOL_PARAMS = { plaidCredentialId: 'credential-record-1' }
const EXECUTOR_DELEGATION = {
  subjectUserId: 'user-1',
  workflowId: 'workflow-1',
}
const ITEM = {
  item_id: 'item-1',
  webhook: null,
  error: null,
  available_products: [],
  billed_products: ['transactions'],
  consent_expiration_time: null,
  update_type: 'background',
}

const toolRegistry = tools as Record<string, ToolConfig | undefined>
const originalPlaidGetItemTool = toolRegistry[PLAID_GET_ITEM_ID]

function installFetch(response: Response) {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit): Promise<Response> => response
  )
  vi.stubGlobal('fetch', Object.assign(fetchMock, { preconnect: vi.fn() }))
  return fetchMock
}

function executePlaidGetItem() {
  return executeTool(PLAID_GET_ITEM_ID, TOOL_PARAMS, {
    internalExecutorDelegation: EXECUTOR_DELEGATION,
  })
}

beforeAll(() => {
  toolRegistry[PLAID_GET_ITEM_ID] = plaidGetItemTool
})

afterAll(() => {
  if (originalPlaidGetItemTool === undefined) {
    delete toolRegistry[PLAID_GET_ITEM_ID]
  } else {
    toolRegistry[PLAID_GET_ITEM_ID] = originalPlaidGetItemTool
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  resetUrlsMock()
  urlsMockFns.mockGetBaseUrl.mockReturnValue(INTERNAL_API_BASE_URL)
  urlsMockFns.mockGetInternalApiBaseUrl.mockReturnValue(INTERNAL_API_BASE_URL)
  mockGenerateInternalDelegationToken.mockResolvedValue('delegation-token')
  mockGenerateInternalToken.mockResolvedValue('internal-token')
})

describe('Plaid tool transport', () => {
  it('prepares the protected internal request and transforms a successful Item response', async () => {
    const fetchMock = installFetch(
      new Response(JSON.stringify({ request_id: 'request-1', item: ITEM }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(executePlaidGetItem()).resolves.toMatchObject({
      success: true,
      output: {
        requestId: 'request-1',
        item: ITEM,
      },
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe(`${INTERNAL_API_BASE_URL}/api/tools/plaid`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(new Headers(init?.headers).has('authorization')).toBe(true)

    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(body).toEqual({
      operation: PLAID_GET_ITEM_ID,
      credentialId: TOOL_PARAMS.plaidCredentialId,
      input: {},
    })
    expect(body).not.toHaveProperty('accessToken')
    expect(body).not.toHaveProperty('clientId')
    expect(body).not.toHaveProperty('secret')
  })

  it('extracts Plaid errors from a non-successful internal response', async () => {
    installFetch(
      new Response(
        JSON.stringify({
          error_type: 'INVALID_REQUEST',
          error_code: 'INVALID_FIELD',
          error_message: 'The request field is invalid',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    )

    await expect(executePlaidGetItem()).resolves.toMatchObject({
      success: false,
      error: 'The request field is invalid (INVALID_FIELD)',
      output: { status: 400 },
    })
  })

  it('rejects a malformed successful response during the real transform', async () => {
    installFetch(
      new Response(JSON.stringify({ item: ITEM }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(executePlaidGetItem()).resolves.toMatchObject({
      success: false,
      error: 'item.request_id must be a string',
    })
  })
})
