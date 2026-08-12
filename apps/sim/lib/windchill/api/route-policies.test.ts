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

import { InternalUnauthenticatedError } from '@/lib/api/server/routes'
import { generateInternalDelegationToken, generateInternalToken } from '@/lib/auth/internal'
import {
  internalWindchillExecutorAuth,
  WINDCHILL_DELEGATION_AUDIENCE,
} from '@/lib/windchill/api/route-policies'

afterAll(resetEnvMock)

describe('internal Windchill route authentication', () => {
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
      delegationContext: {
        kind: 'workflow_execution',
        workflowId: delegation.workflowId,
        executionId: delegation.executionId,
      },
    }))
  })

  it('binds executor identity and scope through the canonical delegation path', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })

    const principal = await internalWindchillExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/tools/windchill', {
        headers: { authorization: `Bearer ${token}` },
      }),
      {}
    )

    expect(principal).toMatchObject({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'canonical-workspace',
      audience: WINDCHILL_DELEGATION_AUDIENCE,
      delegationContext: {
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      },
    })
    expect(mockBindDelegation).toHaveBeenCalledWith(expect.any(Object), {
      audience: WINDCHILL_DELEGATION_AUDIENCE,
      resourceScope: undefined,
    })
  })

  it('rejects session and actorless legacy internal authentication', async () => {
    mockGetSession.mockResolvedValueOnce({
      user: { id: 'user-1' },
      session: { id: 'session-1' },
    })

    await expect(
      internalWindchillExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/tools/windchill'),
        {}
      )
    ).rejects.toBeInstanceOf(InternalUnauthenticatedError)

    const token = await generateInternalToken()
    await expect(
      internalWindchillExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/tools/windchill', {
          headers: { authorization: `Bearer ${token}` },
        }),
        {}
      )
    ).rejects.toBeInstanceOf(InternalUnauthenticatedError)
    expect(mockBindDelegation).not.toHaveBeenCalled()
  })
})
