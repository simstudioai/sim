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
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { v2KnowledgeErrorPolicies } from '@/lib/knowledge/api/route-policies'

describe('v2 knowledge error policies', () => {
  it.each([
    new NoWorkspaceAccessError(),
    new WorkspaceApiKeyAuthorizationError(),
    new DelegatedWorkspaceAuthorizationError(),
    new PrincipalKindAuthorizationError('workspace_api_key', 'knowledge.read'),
  ])('returns forbidden for canonical resource authorization failures', async (error) => {
    const response = v2KnowledgeErrorPolicies.default.render(error)
    expect(response?.status).toBe(403)
    expect(await response?.json()).toMatchObject({ error: { code: 'FORBIDDEN' } })
  })

  it('preserves the personal-api-key policy failure as forbidden', async () => {
    const response = v2KnowledgeErrorPolicies.default.render(new PersonalApiKeysDisabledError())
    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Personal API keys are not allowed for this workspace',
      },
    })
  })

  it('preserves unrelated forbidden business errors', async () => {
    const response = v2KnowledgeErrorPolicies.default.render(
      new OrchestrationError('forbidden', 'Knowledge base transition is forbidden')
    )
    expect(response?.status).toBe(403)
    expect(await response?.json()).toEqual({
      error: { code: 'FORBIDDEN', message: 'Knowledge base transition is forbidden' },
    })
  })

  it('preserves genuine not-found failures', async () => {
    const response = v2KnowledgeErrorPolicies.default.render(
      new OrchestrationError('not_found', 'Knowledge base not found')
    )
    expect(response?.status).toBe(404)
    expect(await response?.json()).toEqual({
      error: { code: 'NOT_FOUND', message: 'Knowledge base not found' },
    })
  })
})
