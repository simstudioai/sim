/**
 * @vitest-environment node
 */
import { authMockFns, createMockRequest } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecute } = vi.hoisted(() => ({ mockExecute: vi.fn() }))

vi.mock('@/lib/credentials/application/list-plaid-options', async () => {
  const { credentialOperations } = await vi.importActual<
    typeof import('@/lib/credentials/application/operations')
  >('@/lib/credentials/application/operations')
  return {
    listPlaidOptions: {
      operation: credentialOperations.read,
      execute: mockExecute,
    },
  }
})

import { OrchestrationError } from '@/lib/core/orchestration/types'
import { POST } from '@/app/api/tools/plaid/options/route'

const body = {
  kind: 'accounts',
  workspaceId: 'workspace-1',
  credentialId: 'credential-1',
} as const

function request(requestBody: unknown = body, headers: Record<string, string> = {}) {
  return createMockRequest('POST', requestBody, headers)
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

  it('rejects malformed and overlong selector requests before execution', async () => {
    expect((await POST(request({ ...body, unexpected: true }))).status).toBe(400)
    expect(
      (
        await POST(
          request({
            ...body,
            kind: 'institution_search',
            query: 'x'.repeat(257),
            country_codes: ['US'],
          })
        )
      ).status
    ).toBe(400)
    expect(mockExecute).not.toHaveBeenCalled()
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
})
