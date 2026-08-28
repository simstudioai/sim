/**
 * @vitest-environment node
 */

import { resetEnvMock } from '@sim/testing'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBindDelegation, mockGetSession } = vi.hoisted(() => ({
  mockBindDelegation: vi.fn(),
  mockGetSession: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getSession: mockGetSession }))
vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegation: mockBindDelegation,
  InvalidInternalDelegationBindingError: class InvalidInternalDelegationBindingError extends Error {},
}))
vi.unmock('@/lib/auth/internal')

import { generateInternalDelegationToken } from '@/lib/auth/internal'
import { internalLogsSessionOrExecutorAuth } from '@/lib/logs/api/route-policies'

afterAll(resetEnvMock)

describe('internal logs route authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue(null)
    mockBindDelegation.mockImplementation(async (delegation, options) => ({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: delegation.subjectUserId,
      workspaceId: 'canonical-workspace',
      delegationId: delegation.delegationId,
      audience: options.audience,
      issuedAt: delegation.issuedAt,
      expiresAt: delegation.expiresAt,
      resourceScope: options.resourceScope,
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: delegation.workflowId,
        ...(delegation.executionId ? { executionId: delegation.executionId } : {}),
      },
    }))
  })

  it('preserves the signed execution origin when the route names a log ID', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })

    const principal = await internalLogsSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/logs/log-1', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { id: 'log-1' }
    )

    expect(principal).toMatchObject({
      kind: 'delegated',
      workspaceId: 'canonical-workspace',
      resourceScope: { executionId: 'execution-1' },
      delegationContext: { executionId: 'execution-1' },
    })
  })

  it('keeps workflow-scoped executor tokens unscoped to one execution', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
    })

    const principal = await internalLogsSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/logs/log-1', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { id: 'log-1' }
    )

    expect(principal.resourceScope).toBeUndefined()
  })

  it('rejects an executor delegation without canonical workflow execution context', async () => {
    mockBindDelegation.mockResolvedValueOnce({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'canonical-workspace',
      delegationId: 'delegation-1',
      audience: 'sim:logs',
      issuedAt: new Date('2026-08-27T00:00:00.000Z'),
      expiresAt: new Date('2026-08-27T00:05:00.000Z'),
    })
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })

    await expect(
      internalLogsSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/logs/log-1', {
          headers: { authorization: `Bearer ${token}` },
        }),
        { id: 'log-1' }
      )
    ).rejects.toThrow('Executor log delegation is missing its canonical workflow execution context')
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
