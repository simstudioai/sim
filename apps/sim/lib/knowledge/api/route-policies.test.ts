/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import {
  DelegatedWorkspaceAuthorizationError,
  NoWorkspaceAccessError,
  PersonalApiKeysDisabledError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  internalKnowledgeErrorPolicies,
  v2KnowledgeErrorPolicies,
} from '@/lib/knowledge/api/route-policies'
import { SearchIndexDormantError } from '@/lib/sim-search/indexed/gate'

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

  it('preserves the personal-api-key policy failure as forbidden', async () => {
    const response = v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization.render(
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

  it('does not conceal unrelated forbidden business errors', async () => {
    const response = v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization.render(
      new OrchestrationError('forbidden', 'Knowledge base transition is forbidden')
    )
    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Knowledge base transition is forbidden' },
    })
  })

  it('preserves genuine not-found failures', async () => {
    const response = v2KnowledgeErrorPolicies.concealKnowledgeBaseAuthorization.render(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )
    expect(response?.status).toBe(404)
    expect(await response?.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Knowledge base not found' },
    })
  })
})

describe('dormant search index projection', () => {
  const message = 'This search index is inactive; use Sim Search.'

  it('refuses the internal search as a conflict with the dormant message', () => {
    expect(internalKnowledgeErrorPolicies.search.project(new SearchIndexDormantError())).toEqual({
      status: 409,
      body: { error: message },
      headers: undefined,
    })
  })

  it('refuses the public search as a conflict with the dormant message', async () => {
    const response = v2KnowledgeErrorPolicies.concealKnowledgeBaseUsageAuthorization.render(
      new SearchIndexDormantError()
    )
    expect(response?.status).toBe(409)
    expect(await response?.json()).toEqual({ error: { code: 'CONFLICT', message } })
  })
})
