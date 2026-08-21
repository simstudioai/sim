/**
 * @vitest-environment node
 */
import { createMockRequest, resetEnvMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockInvalidBindingError, mockBindDelegation, mockExecute, mockGetSession } = vi.hoisted(
  () => ({
    MockInvalidBindingError: class extends Error {},
    mockBindDelegation: vi.fn(),
    mockExecute: vi.fn(),
    mockGetSession: vi.fn(),
  })
)

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegation: mockBindDelegation,
  InvalidInternalDelegationBindingError: MockInvalidBindingError,
}))
vi.unmock('@/lib/auth/internal')
vi.mock('@/lib/credentials/application/use-plaid-service-account', () => ({
  usePlaidServiceAccount: {
    operation: { id: 'credentials.plaid.use' },
    execute: mockExecute,
  },
}))

import { PLAID_TOOL_REQUEST_MAX_BYTES } from '@/lib/api/contracts/tools/plaid'
import { generateInternalDelegationToken, generateInternalToken } from '@/lib/auth/internal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/tools/plaid/route'
import { PlaidGatewayError, PlaidProviderError } from '@/tools/plaid/utils.server'

const WORKFLOW_ID = '550e8400-e29b-41d4-a716-446655440001'
const WORKSPACE_ID = '550e8400-e29b-41d4-a716-446655440000'
const body = {
  operation: 'plaid_get_item',
  credentialId: 'credential-1',
  input: {},
} as const
let delegationToken = ''
let legacyInternalToken = ''

function request(
  requestBody: unknown = body,
  headers: Record<string, string> = { authorization: `Bearer ${delegationToken}` }
) {
  return createMockRequest('POST', requestBody, headers)
}

function rawRequest(
  requestBody: string,
  {
    headers = { authorization: `Bearer ${delegationToken}` },
    signal,
  }: { headers?: Record<string, string>; signal?: AbortSignal } = {}
) {
  return new NextRequest('http://localhost:3000/api/tools/plaid', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: requestBody,
    signal,
  })
}

beforeAll(async () => {
  delegationToken = await generateInternalDelegationToken({
    subjectUserId: 'user-1',
    workflowId: WORKFLOW_ID,
  })
  legacyInternalToken = await generateInternalToken('user-1')
})

afterAll(resetEnvMock)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSession.mockResolvedValue(null)
  mockBindDelegation.mockImplementation(async (claims, options) => ({
    kind: 'delegated',
    serviceId: 'executor',
    subjectUserId: claims.subjectUserId,
    workspaceId: WORKSPACE_ID,
    delegationId: claims.delegationId,
    audience: options.audience,
    issuedAt: claims.issuedAt,
    expiresAt: claims.expiresAt,
    delegationContext: {
      kind: 'workflow_execution',
      workflowId: claims.workflowId,
      executionId: claims.executionId,
    },
  }))
  mockExecute.mockResolvedValue({
    item: { item_id: 'item-1' },
    request_id: 'request-1',
    future_provider_field: { enabled: true },
  })
})

describe('POST /api/tools/plaid', () => {
  it('accepts executor delegation and forwards the validated operation with cancellation', async () => {
    const incoming = request()
    const response = await POST(incoming)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      item: { item_id: 'item-1' },
      request_id: 'request-1',
      future_provider_field: { enabled: true },
    })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: expect.objectContaining({
          kind: 'delegated',
          serviceId: 'executor',
          workspaceId: WORKSPACE_ID,
        }),
        input: { body, signal: incoming.signal },
      })
    )
  })

  it.each([
    [
      'session',
      () => ({}),
      async () =>
        mockGetSession.mockResolvedValue({
          user: { id: 'user-1' },
          session: { id: 'session-1' },
        }),
    ],
    ['API key', () => ({ 'x-api-key': 'api-key' }), async () => undefined],
    [
      'generic internal JWT',
      () => ({ authorization: `Bearer ${legacyInternalToken}` }),
      async () => undefined,
    ],
  ])('rejects %s authentication', async (_label, buildHeaders, arrange) => {
    await arrange()
    const response = await POST(request(body, buildHeaders()))
    expect(response.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects delegation that no longer binds to an active workflow execution', async () => {
    mockBindDelegation.mockRejectedValueOnce(new MockInvalidBindingError())
    const response = await POST(request())
    expect(response.status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('authenticates before parsing the body', async () => {
    const response = await POST(request({ operation: 'made_up' }, {}))
    expect(response.status).toBe(401)
  })

  it('rejects malformed operation input at the route contract', async () => {
    const response = await POST(request({ ...body, unexpected: true }))
    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON before application execution', async () => {
    const response = await POST(rawRequest('{"operation":'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Request body must be valid JSON',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects an actual body larger than the Plaid tool-route ceiling', async () => {
    const response = await POST(
      rawRequest(
        JSON.stringify({
          ...body,
          padding: 'x'.repeat(PLAID_TOOL_REQUEST_MAX_BYTES),
        })
      )
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: `Request body exceeds the maximum allowed size of ${PLAID_TOOL_REQUEST_MAX_BYTES} bytes`,
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects an empty institution products array at the authenticated route boundary', async () => {
    const response = await POST(
      request({
        operation: 'plaid_search_institutions',
        credentialId: 'credential-1',
        input: {
          query: 'Bank',
          country_codes: ['US'],
          products: [],
        },
      })
    )

    expect(response.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('accepts a 256-character sync cursor and rejects a 257-character cursor', async () => {
    const acceptedBody = {
      operation: 'plaid_sync_transactions' as const,
      credentialId: 'credential-1',
      input: { cursor: 'x'.repeat(256) },
    }
    const accepted = await POST(request(acceptedBody))

    expect(accepted.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ body: acceptedBody }) })
    )

    mockExecute.mockClear()
    const rejected = await POST(
      request({
        ...acceptedBody,
        input: { cursor: 'x'.repeat(257) },
      })
    )

    expect(rejected.status).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('accepts RFC3339 balance timestamps with a numeric offset', async () => {
    const offsetBody = {
      operation: 'plaid_get_balances',
      credentialId: 'credential-1',
      input: { min_last_updated_datetime: '2026-08-18T12:30:00-07:00' },
    } as const
    const response = await POST(request(offsetBody))

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ input: expect.objectContaining({ body: offsetBody }) })
    )
  })

  it.each([
    [
      'wrong workspace or provider',
      new OrchestrationError('not_found', 'Credential not found'),
      404,
    ],
    [
      'inaccessible credential',
      new OrchestrationError('forbidden', 'Credential access required'),
      403,
    ],
  ])('projects %s without exposing secrets', async (_label, error, status) => {
    mockExecute.mockRejectedValueOnce(error)
    const response = await POST(request())
    expect(response.status).toBe(status)
    expect(JSON.stringify(await response.json())).not.toContain('client-secret')
  })

  it('preserves Plaid provider status and error fields', async () => {
    mockExecute.mockRejectedValueOnce(
      new PlaidProviderError(400, {
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_type: 'ITEM_ERROR',
      })
    )
    const response = await POST(request())
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error_code: 'ITEM_LOGIN_REQUIRED',
      error_type: 'ITEM_ERROR',
    })
  })

  it('projects Plaid gateway failures as a safe 502 response', async () => {
    mockExecute.mockRejectedValueOnce(new PlaidGatewayError('Plaid request timed out'))

    const response = await POST(request())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ error: 'Plaid request timed out' })
  })

  it('returns 499 when application execution fails after the client disconnects', async () => {
    const controller = new AbortController()
    mockExecute.mockImplementationOnce(async () => {
      controller.abort()
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    const response = await POST(
      rawRequest(JSON.stringify(body), {
        signal: controller.signal,
      })
    )

    expect(response.status).toBe(499)
    await expect(response.json()).resolves.toMatchObject({ error: 'Client cancelled request' })
  })

  it('fails closed on an unexpected application error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('database-password-should-not-leak'))

    const response = await POST(request())

    expect(response.status).toBe(500)
    const responseBody = await response.json()
    expect(responseBody).toMatchObject({ error: 'Internal server error' })
    expect(JSON.stringify(responseBody)).not.toContain('database-password-should-not-leak')
  })

  it('fails closed when application output violates the response contract', async () => {
    mockExecute.mockResolvedValueOnce({ item: { item_id: 'item-1' } })

    const response = await POST(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: 'Internal server error' })
  })
})
