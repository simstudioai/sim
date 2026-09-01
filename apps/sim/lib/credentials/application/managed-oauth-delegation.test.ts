/**
 * @vitest-environment node
 */
import { bindPrincipalExecutionMetadata } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBindRuntimeWorkflowExecutionPrincipal } = vi.hoisted(() => ({
  mockBindRuntimeWorkflowExecutionPrincipal: vi.fn(),
}))

vi.mock('@/lib/auth/internal-delegation', () => ({
  bindRuntimeWorkflowExecutionPrincipal: mockBindRuntimeWorkflowExecutionPrincipal,
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

function runtimePrincipal() {
  return bindPrincipalExecutionMetadata(
    { kind: 'session', userId: 'user-origin', sessionId: 'session-origin' },
    {
      executionId: 'execution-origin',
      rootWorkflowId: 'workflow-origin',
      currentWorkflow: {
        workflowId: 'workflow-origin',
        mode: 'deployment',
        deploymentVersionId: 'deployment-version-1',
      },
    }
  )
}

describe('bindExecutorManagedOAuthDelegation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBindRuntimeWorkflowExecutionPrincipal.mockImplementation(async (principal) => principal)
  })

  it('requires canonical execution metadata before binding', async () => {
    await expect(
      bindExecutorManagedOAuthDelegation(
        { kind: 'session', userId: 'user-origin', sessionId: 'session-origin' },
        'cred-1'
      )
    ).rejects.toThrow('Workflow execution principal is missing execution metadata')
    expect(mockBindRuntimeWorkflowExecutionPrincipal).not.toHaveBeenCalled()
  })

  it('revalidates and returns the same semantic runtime principal', async () => {
    const principal = runtimePrincipal()

    await expect(bindExecutorManagedOAuthDelegation(principal, 'cred-1')).resolves.toEqual(
      principal
    )
    expect(mockBindRuntimeWorkflowExecutionPrincipal).toHaveBeenCalledWith(principal)
  })

  it('rejects an empty credential assertion before binding', async () => {
    await expect(
      bindExecutorManagedOAuthDelegation(runtimePrincipal(), ' ')
    ).rejects.toBeInstanceOf(InvalidManagedOAuthDelegationError)
    expect(mockBindRuntimeWorkflowExecutionPrincipal).not.toHaveBeenCalled()
  })

  it('wraps canonical binding rejections into the managed-OAuth delegation error', async () => {
    mockBindRuntimeWorkflowExecutionPrincipal.mockRejectedValue(
      new InvalidInternalDelegationBindingError('stale workflow context')
    )

    await expect(
      bindExecutorManagedOAuthDelegation(runtimePrincipal(), 'cred-1')
    ).rejects.toBeInstanceOf(InvalidManagedOAuthDelegationError)
  })

  it('rethrows unexpected binding failures unchanged', async () => {
    mockBindRuntimeWorkflowExecutionPrincipal.mockRejectedValue(new Error('db unavailable'))

    await expect(bindExecutorManagedOAuthDelegation(runtimePrincipal(), 'cred-1')).rejects.toThrow(
      'db unavailable'
    )
  })
})
