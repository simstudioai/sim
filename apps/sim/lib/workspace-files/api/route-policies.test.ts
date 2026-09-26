import { authMockFns, resetEnvMock } from '@sim/testing'
import {
  authInternalDelegationMock,
  authInternalDelegationMockFns,
  MockInvalidInternalDelegationBindingError,
} from '@sim/testing/mocks/auth-internal-delegation.mock'
import { NextRequest } from 'next/server'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/internal-delegation', () => authInternalDelegationMock)
vi.unmock('@/lib/auth/internal')

import { InternalUnauthenticatedError } from '@/lib/api/server/routes'
import { generateInternalDelegationToken, generateInternalToken } from '@/lib/auth/internal'
import { internalSessionOrExecutorAuth } from '@/lib/workspace-files/api'

const mockGetSession = authMockFns.mockGetSession
const mockBindDelegation = authInternalDelegationMockFns.mockBindInternalExecutorDelegation

afterAll(resetEnvMock)

describe('internal file route authentication', () => {
  beforeEach(() => {
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
        executionId: delegation.executionId,
      },
    }))
  })

  it('binds a scoped executor token without trusting the workspace route parameter', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })

    const principal = await internalSessionOrExecutorAuth.authenticate(
      new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1', {
        headers: { authorization: `Bearer ${token}` },
      }),
      { id: 'ws-1', fileId: 'file-1' }
    )

    expect(principal).toMatchObject({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: 'user-1',
      workspaceId: 'canonical-workspace',
      audience: 'sim:workspace-files',
      resourceScope: { fileId: 'file-1' },
    })
    expect(mockBindDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      }),
      {
        audience: 'sim:workspace-files',
        resourceScope: { fileId: 'file-1' },
      }
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
    expect(mockBindDelegation).not.toHaveBeenCalled()
  })

  it('rejects a scoped token whose canonical workflow binding no longer exists', async () => {
    const token = await generateInternalDelegationToken({
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
    })
    mockBindDelegation.mockRejectedValue(new MockInvalidInternalDelegationBindingError())

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
      subjectUserId: 'user-1',
      workflowId: 'workflow-1',
    })
    const infrastructureError = new Error('database unavailable')
    mockBindDelegation.mockRejectedValue(infrastructureError)

    await expect(
      internalSessionOrExecutorAuth.authenticate(
        new NextRequest('http://localhost/api/workspaces/ws-1/files/file-1', {
          headers: { authorization: `Bearer ${token}` },
        }),
        { id: 'ws-1', fileId: 'file-1' }
      )
    ).rejects.toBe(infrastructureError)
  })
})
