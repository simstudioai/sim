/**
 * @vitest-environment node
 */

import { resetEnvMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockInvalidBindingError, mockBindDelegationAdmission, mockGetSession } = vi.hoisted(() => {
  class MockInvalidBindingError extends Error {}
  return {
    MockInvalidBindingError,
    mockBindDelegationAdmission: vi.fn(),
    mockGetSession: vi.fn(),
  }
})

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegationAdmission: mockBindDelegationAdmission,
  InvalidInternalDelegationBindingError: MockInvalidBindingError,
}))
vi.unmock('@/lib/auth/internal')

import { InternalUnauthenticatedError } from '@/lib/api/server/routes'
import { generateInternalDelegationToken, generateInternalToken } from '@/lib/auth/internal'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import { internalSessionOrExecutorAuth } from '@/lib/workspace-files/api'

afterAll(resetEnvMock)

describe('internal file route authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockBindDelegationAdmission.mockImplementation(async (delegation) => ({
      principal: delegation.principal,
      workspaceId: 'canonical-workspace',
    }))
  })

  it('binds a scoped executor token without trusting the workspace route parameter', async () => {
    const token = await generateInternalDelegationToken({
      principal: createTestRuntimePrincipal(),
    })

    const principal = await internalSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { id: 'ws-1', fileId: 'file-1' }
    )

    expect(principal).toMatchObject({
      kind: 'session',
      executionMetadata: { executionId: 'execution-1' },
    })
    expect(mockBindDelegationAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ kind: 'session' }) })
    )
    expect(mockGetSession).not.toHaveBeenCalled()
  })

  it('rejects legacy actorless internal tokens before canonical binding', async () => {
    const token = await generateInternalToken()

    await expect(
      internalSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1', {
          headers: { authorization: `Bearer ${token}` },
        }),
        { id: 'ws-1', fileId: 'file-1' }
      )
    ).rejects.toBeInstanceOf(InternalUnauthenticatedError)
    expect(mockBindDelegationAdmission).not.toHaveBeenCalled()
  })

  it('rejects a scoped token whose canonical workflow binding no longer exists', async () => {
    const token = await generateInternalDelegationToken({
      principal: createTestRuntimePrincipal(),
    })
    mockBindDelegationAdmission.mockRejectedValue(new MockInvalidBindingError())

    await expect(
      internalSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1', {
          headers: { authorization: `Bearer ${token}` },
        }),
        { id: 'ws-1', fileId: 'file-1' }
      )
    ).rejects.toBeInstanceOf(InternalUnauthenticatedError)
  })

  it('does not render canonical-binding infrastructure failures as bad credentials', async () => {
    const token = await generateInternalDelegationToken({
      principal: createTestRuntimePrincipal(),
    })
    const infrastructureError = new Error('database unavailable')
    mockBindDelegationAdmission.mockRejectedValue(infrastructureError)

    await expect(
      internalSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1', {
          headers: { authorization: `Bearer ${token}` },
        }),
        { id: 'ws-1', fileId: 'file-1' }
      )
    ).rejects.toBe(infrastructureError)
  })

  it('preserves browser session principals when no service token is supplied', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })

    await expect(
      internalSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1'),
        { id: 'ws-1', fileId: 'file-1' }
      )
    ).resolves.toEqual({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
  })
})
