/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutorDelegationOrigin } from '@/executor/types'

const { mockBindInternalExecutorDelegation } = vi.hoisted(() => ({
  mockBindInternalExecutorDelegation: vi.fn(),
}))

vi.mock('@/lib/auth/internal-delegation', () => ({
  bindInternalExecutorDelegation: mockBindInternalExecutorDelegation,
  InvalidInternalDelegationBindingError: class InvalidInternalDelegationBindingError extends Error {},
}))

vi.mock('@/lib/auth/internal', () => ({
  InvalidInternalDelegationTokenError: class InvalidInternalDelegationTokenError extends Error {},
  verifyInternalDelegationToken: vi.fn(),
}))

import { InvalidInternalDelegationBindingError } from '@/lib/auth/internal-delegation'
import {
  bindExecutorManagedOAuthDelegation,
  InvalidManagedOAuthDelegationError,
} from '@/lib/credentials/application/managed-oauth-delegation'

function delegationOrigin(
  overrides: Partial<ExecutorDelegationOrigin> = {}
): ExecutorDelegationOrigin {
  return {
    subjectUserId: 'user-origin',
    workflowId: 'workflow-origin',
    executionId: 'execution-origin',
    currentWorkflow: { workflowId: 'workflow-origin' },
    ...overrides,
  } as ExecutorDelegationOrigin
}

describe('bindExecutorManagedOAuthDelegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBindInternalExecutorDelegation.mockImplementation(async (claims, options) => ({
      kind: 'delegated',
      serviceId: 'executor',
      subjectUserId: claims.subjectUserId,
      workspaceId: 'workspace-canonical',
      delegationId: claims.delegationId,
      audience: options.audience,
      resourceScope: options.resourceScope,
    }))
  })

  it('requires current workflow authority before binding', async () => {
    await expect(
      bindExecutorManagedOAuthDelegation(delegationOrigin({ currentWorkflow: undefined }), 'cred-1')
    ).rejects.toThrow('Managed credential delegation is missing current workflow authority')
    expect(mockBindInternalExecutorDelegation).not.toHaveBeenCalled()
  })

  it('binds the origin to the managed-OAuth audience scoped to one credential', async () => {
    const principal = await bindExecutorManagedOAuthDelegation(delegationOrigin(), 'cred-1')

    expect(mockBindInternalExecutorDelegation).toHaveBeenCalledWith(
      expect.objectContaining({
        serviceId: 'executor',
        subjectUserId: 'user-origin',
        workflowId: 'workflow-origin',
        executionId: 'execution-origin',
        currentWorkflow: { workflowId: 'workflow-origin' },
      }),
      expect.objectContaining({
        audience: 'sim:managed-oauth-credentials',
        resourceScope: { credentialId: 'cred-1' },
      })
    )
    expect(principal).toMatchObject({
      audience: 'sim:managed-oauth-credentials',
      resourceScope: { credentialId: 'cred-1' },
    })
  })

  it('wraps binding rejections into the managed-OAuth delegation error', async () => {
    mockBindInternalExecutorDelegation.mockRejectedValue(
      new InvalidInternalDelegationBindingError('stale workflow context')
    )

    await expect(
      bindExecutorManagedOAuthDelegation(delegationOrigin(), 'cred-1')
    ).rejects.toBeInstanceOf(InvalidManagedOAuthDelegationError)
  })

  it('rethrows unexpected binding failures unchanged', async () => {
    mockBindInternalExecutorDelegation.mockRejectedValue(new Error('db unavailable'))

    await expect(bindExecutorManagedOAuthDelegation(delegationOrigin(), 'cred-1')).rejects.toThrow(
      'db unavailable'
    )
  })
})
