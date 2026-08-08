/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  DelegatedWorkspaceAuthorizationError,
  InsufficientWorkspacePermissionsError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2WorkflowErrorPolicies } from '@/lib/workflows/api/route-policies'

describe('v2 workflow error policies', () => {
  it.each([
    new InsufficientWorkspacePermissionsError(),
    new WorkspaceApiKeyAuthorizationError(),
    new DelegatedWorkspaceAuthorizationError(),
    new PrincipalKindAuthorizationError('workspace_api_key', 'workflows.deploy'),
  ])('conceals workflow authorization failures as absence', async (error) => {
    const response = v2WorkflowErrorPolicies.concealWorkflowAuthorization.render(error)
    expect(response?.status).toBe(404)
    expect(await response?.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Workflow not found' },
    })
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
      },
    })
  })

  it('uses run-specific concealment text for canonical run operations', async () => {
    const response = v2WorkflowErrorPolicies.concealRunAuthorization.render(
      new InsufficientWorkspacePermissionsError()
    )
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
})
