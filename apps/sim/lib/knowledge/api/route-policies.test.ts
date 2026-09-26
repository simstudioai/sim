import { describe, expect, it } from 'vitest'
import {
  DelegatedWorkspaceAuthorizationError,
  NoWorkspaceAccessError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'

describe('v2 knowledge error policies', () => {
  it.each([
    new NoWorkspaceAccessError(),
    new WorkspaceApiKeyScopeAuthorizationError(),
    new DelegatedWorkspaceAuthorizationError(),
  ])('conceals cross-tenant knowledge authorization failures', async (error) => {
    const response = v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization.render(error)
    expect(response?.status).toBe(404)
    expect(await response?.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Knowledge base not found' },
    })
  })

  it.each([
    new WorkspaceApiKeyAuthorizationError(),
    new PrincipalKindAuthorizationError('workspace_api_key', 'knowledge.read'),
  ])('preserves same-workspace principal policy failures as forbidden', async (error) => {
    const response = v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization.render(error)
    expect(response?.status).toBe(403)
    expect(await response?.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('does not conceal unrelated forbidden business errors', async () => {
    const response = v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization.render(
      new OrchestrationError('forbidden', 'Knowledge base transition is forbidden')
    )
    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Knowledge base transition is forbidden' },
    })
  })
})
