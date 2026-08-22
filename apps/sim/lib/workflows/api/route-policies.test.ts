/**
 * @vitest-environment node
 */
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DelegatedWorkspaceAuthorizationError,
  NoWorkspaceAccessError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'

const mocks = vi.hoisted(() => ({
  authenticateApiKey: vi.fn(),
  updateLastUsed: vi.fn(),
}))

vi.mock('@/lib/api-key/service', () => ({
  authenticateApiKeyFromHeader: mocks.authenticateApiKey,
  updateApiKeyLastUsed: mocks.updateLastUsed,
}))

import {
  internalWorkflowReadAuth,
  v2WorkflowErrorPolicies,
} from '@/lib/workflows/api/route-policies'

describe('v2 workflow error policies', () => {
  it.each([
    new NoWorkspaceAccessError(),
    new WorkspaceApiKeyScopeAuthorizationError(),
    new DelegatedWorkspaceAuthorizationError(),
  ])('conceals cross-tenant workflow authorization failures', async (error) => {
    const response = v2WorkflowErrorPolicies.concealWorkflowAuthorization.render(error)
    expect(response?.status).toBe(404)
    expect(await response?.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workflow not found' },
    })
  })

  it.each([
    new WorkspaceApiKeyAuthorizationError(),
    new PrincipalKindAuthorizationError('workspace_api_key', 'workflows.deploy'),
  ])('preserves same-workspace principal policy failures as forbidden', async (error) => {
    const response = v2WorkflowErrorPolicies.concealWorkflowAuthorization.render(error)
    expect(response?.status).toBe(403)
    expect(await response?.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('preserves the personal-api-key workspace policy failure as forbidden', async () => {
    const response = v2WorkflowErrorPolicies.concealWorkflowAuthorization.render(
      new PersonalApiKeysDisabledError()
    )
    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Personal API keys are not allowed for this workspace',
        details: { code: 'PERSONAL_API_KEYS_DISABLED' },
      },
    })
  })

  it('uses run-specific concealment text for canonical run operations', async () => {
    const response = v2WorkflowErrorPolicies.concealRunAuthorization.render(
      new NoWorkspaceAccessError()
    )
    expect(response?.status).toBe(404)
    expect(await response?.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Run not found' },
    })
  })

  it('does not conceal unrelated forbidden business errors', async () => {
    const response = v2WorkflowErrorPolicies.concealWorkflowAuthorization.render(
      new OrchestrationError('forbidden', 'Workflow transition is forbidden')
    )
    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Workflow transition is forbidden' },
    })
  })

  it('preserves genuine not-found failures', async () => {
    const response = v2WorkflowErrorPolicies.concealWorkflowAuthorization.render(
      new OrchestrationError('not_found', 'Workflow not found')
    )
    expect(response?.status).toBe(404)
    expect(await response?.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workflow not found' },
    })
  })
})

describe('internal workflow read auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('constructs a workspace principal only from the verified API-key result', async () => {
    mocks.authenticateApiKey.mockResolvedValue({
      success: true,
      keyId: 'key-1',
      keyType: 'workspace',
      userId: 'forged-route-user',
      workspaceId: 'workspace-1',
    })

    const principal = await internalWorkflowReadAuth.authenticate(
      new NextRequest('http://localhost/api/workflows/forged/status', {
        headers: { 'x-api-key': 'secret-key' },
      }),
      { id: 'forged-workflow' }
    )

    expect(principal).toEqual({
      kind: 'workspace_api_key',
      workspaceId: 'workspace-1',
      keyId: 'key-1',
    })
    expect(mocks.updateLastUsed).toHaveBeenCalledWith('key-1')
  })

  it('fails closed when API-key verification does not return a principal identity', async () => {
    mocks.authenticateApiKey.mockResolvedValue({ success: false, error: 'Invalid API key' })

    await expect(
      internalWorkflowReadAuth.authenticate(
        new NextRequest('http://localhost/api/workflows/workflow-1/status', {
          headers: { 'x-api-key': 'invalid' },
        }),
        { id: 'workflow-1' }
      )
    ).rejects.toMatchObject({ name: 'InternalUnauthenticatedError' })

    expect(mocks.updateLastUsed).not.toHaveBeenCalled()
  })
})
