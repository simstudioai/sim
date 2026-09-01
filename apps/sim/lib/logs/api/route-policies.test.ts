/**
 * @vitest-environment node
 */

import { resetEnvMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBindDelegationAdmission, mockGetSession } = vi.hoisted(() => ({
  mockBindDelegationAdmission: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegationAdmission: mockBindDelegationAdmission,
  InvalidInternalDelegationBindingError: class InvalidInternalDelegationBindingError extends Error {},
}))
vi.unmock('@/lib/auth/internal')

import { generateInternalDelegationToken } from '@/lib/auth/internal'
import { createTestRuntimePrincipal } from '@/lib/auth/runtime-principal.test-support'
import { internalLogsSessionOrExecutorAuth } from '@/lib/logs/api/route-policies'

afterAll(resetEnvMock)

describe('internal logs route authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockBindDelegationAdmission.mockImplementation(async (delegation) => ({
      principal: delegation.principal,
      workspaceId: 'canonical-workspace',
    }))
  })

  it('preserves the signed execution origin when the route names a log ID', async () => {
    const token = await generateInternalDelegationToken({
      principal: createTestRuntimePrincipal(),
    })

    const principal = await internalLogsSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/logs/log-1', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { id: 'log-1' }
    )

    expect(principal).toMatchObject({
      kind: 'session',
      executionMetadata: { executionId: 'execution-1' },
    })
  })

  it('keeps workflow-scoped executor tokens unscoped to one execution', async () => {
    const token = await generateInternalDelegationToken({
      principal: createTestRuntimePrincipal(),
    })

    const principal = await internalLogsSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/logs/log-1', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { id: 'log-1' }
    )

    expect(principal.executionMetadata.executionId).toBe('execution-1')
  })

  it('rejects an executor delegation without canonical workflow execution context', async () => {
    mockBindDelegationAdmission.mockResolvedValueOnce({
      principal: { kind: 'session', userId: 'user-1', sessionId: 'session-1' },
      workspaceId: 'canonical-workspace',
    })
    const token = await generateInternalDelegationToken({
      principal: createTestRuntimePrincipal(),
    })

    await expect(
      internalLogsSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/logs/log-1', {
          headers: { authorization: `Bearer ${token}` },
        }),
        { id: 'log-1' }
      )
    ).resolves.toEqual({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
  })

  it('preserves browser session principals', async () => {
    mockGetSession.mockResolvedValue({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })

    await expect(
      internalLogsSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/logs/log-1'),
        { id: 'log-1' }
      )
    ).resolves.toEqual({ kind: 'session', userId: 'user-1', sessionId: 'session-1' })
  })
})
