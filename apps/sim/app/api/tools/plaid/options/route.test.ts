/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }))

vi.mock('@/lib/credentials/application/list-plaid-options', () => ({
  listPlaidOptions: {
    operation: { id: 'credentials.read' },
    execute: mockExecute,
  },
}))

import { PLAID_OPTIONS_REQUEST_MAX_BYTES } from '@/lib/api/contracts/selectors/plaid'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/tools/plaid/options/route'
import { PlaidGatewayError, PlaidProviderError } from '@/tools/plaid/utils.server'

const body = {
  kind: 'accounts',
  workspaceId: 'workspace-1',
  credentialId: 'credential-1',
} as const

function request(requestBody: unknown = body, headers: Record<string, string> = {}) {
  return createMockRequest('POST', requestBody, headers)
}

function rawRequest(
  requestBody: string,
  signal?: AbortSignal,
  headers: Record<string, string> = {}
) {
  return new NextRequest('http://localhost:3000/api/tools/plaid/options', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: requestBody,
    signal,
  })
}

describe('POST /api/tools/plaid/options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMockFns.mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })
    mockExecute.mockResolvedValue({ options: [{ id: 'acc-1', label: 'Checking' }] })
  })

  it('accepts a session and forwards only selector scope plus cancellation', async () => {
    const incoming = request()
    const response = await POST(incoming)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      options: [{ id: 'acc-1', label: 'Checking' }],
    })
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
        input: { body, signal: incoming.signal },
        request: incoming,
      })
    )
  })

  it('rejects unauthenticated and API-key callers', async () => {
    authMockFns.mockGetSession.mockResolvedValue(null)
    expect((await POST(request())).status).toBe(401)
    expect((await POST(request(body, { 'x-api-key': 'key' }))).status).toBe(401)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects malformed selector requests before execution', async () => {
    expect((await POST(request({ ...body, unexpected: true }))).status).toBe(400)
    expect(
      (
        await POST(
          request({
            ...body,
            kind: 'institution_search',
            query: 'Bank',
            country_codes: ['ZZ'],
          })
        )
      ).status
    ).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects invalid JSON before application execution', async () => {
    const response = await POST(rawRequest('{"kind":'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Request body must be valid JSON',
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('rejects an actual body larger than the Plaid selector-route ceiling', async () => {
    const response = await POST(
      rawRequest(
        JSON.stringify({
          ...body,
          padding: 'x'.repeat(PLAID_OPTIONS_REQUEST_MAX_BYTES),
        })
      )
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      error: `Request body exceeds the maximum allowed size of ${PLAID_OPTIONS_REQUEST_MAX_BYTES} bytes`,
    })
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it('accepts long provider identifiers within the route byte ceiling', async () => {
    const query = 'x'.repeat(10_001)
    const response = await POST(
      request({
        ...body,
        kind: 'institution_search',
        query,
        country_codes: ['US'],
      })
    )

    expect(response.status).toBe(200)
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        input: { body: expect.objectContaining({ query }), signal: expect.any(AbortSignal) },
      })
    )
  })

  it.each([
    [new OrchestrationError('not_found', 'Credential not found'), 404],
    [new OrchestrationError('forbidden', 'Credential access required'), 403],
  ])('projects credential access failures', async (error, status) => {
    mockExecute.mockRejectedValueOnce(error)
    const response = await POST(request())
    expect(response.status).toBe(status)
    expect(JSON.stringify(await response.json())).not.toContain('item-token')
  })

  it('preserves sanitized Plaid provider errors', async () => {
    mockExecute.mockRejectedValueOnce(
      new PlaidProviderError(400, {
        error_code: 'ITEM_LOGIN_REQUIRED',
        error_type: 'ITEM_ERROR',
        request_id: 'plaid-request-1',
      })
    )

    const response = await POST(request())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error_code: 'ITEM_LOGIN_REQUIRED',
      error_type: 'ITEM_ERROR',
      request_id: 'plaid-request-1',
    })
  })

  it('projects Plaid gateway failures as a safe 502 response', async () => {
    mockExecute.mockRejectedValueOnce(new PlaidGatewayError('Plaid request timed out'))

    const response = await POST(request())

    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ error: 'Plaid request timed out' })
  })

  it('returns 499 when selector execution fails after the client disconnects', async () => {
    const controller = new AbortController()
    mockExecute.mockImplementationOnce(async () => {
      controller.abort()
      throw new DOMException('The operation was aborted.', 'AbortError')
    })

    const response = await POST(rawRequest(JSON.stringify(body), controller.signal))

    expect(response.status).toBe(499)
    await expect(response.json()).resolves.toMatchObject({ error: 'Client cancelled request' })
  })

  it('fails closed on an unexpected selector error', async () => {
    mockExecute.mockRejectedValueOnce(new Error('item-token-should-not-leak'))

    const response = await POST(request())

    expect(response.status).toBe(500)
    const responseBody = await response.json()
    expect(responseBody).toMatchObject({ error: 'Internal server error' })
    expect(JSON.stringify(responseBody)).not.toContain('item-token-should-not-leak')
  })

  it('fails closed when selector output violates the response contract', async () => {
    mockExecute.mockResolvedValueOnce({ options: [{ id: '', label: '' }] })

    const response = await POST(request())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toMatchObject({ error: 'Internal server error' })
  })
})
