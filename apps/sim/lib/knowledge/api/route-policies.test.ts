import { describe, expect, it } from 'vitest'
import {
  DelegatedWorkspaceAuthorizationError,
  NoWorkspaceAccessError,
  PrincipalKindAuthorizationError,
  WorkspaceApiKeyAuthorizationError,
  WorkspaceApiKeyScopeAuthorizationError,
} from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { EmbeddingAPIError } from '@/lib/embeddings/api-error'
import { EmbeddingQuotaExhaustedError } from '@/lib/embeddings/client'
import {
  internalKnowledgeErrorPolicies,
  v2KnowledgeErrorPolicies,
} from '@/lib/knowledge/api/route-policies'
import { SearchDeadlineError } from '@/lib/knowledge/search/budget'

function quotaError(isBYOK: boolean, providerId: 'openai' | 'ollama' = 'openai') {
  return new EmbeddingQuotaExhaustedError(providerId, undefined, isBYOK)
}

describe('internal knowledge search error policy', () => {
  it.each([
    ['a workspace key out of quota', quotaError(true), 503, /this workspace's embedding API key/],
    ['the platform key out of quota', quotaError(false), 503, /^Knowledge search is temporarily/],
    [
      'every fallback provider out of quota',
      new AggregateError([quotaError(false), quotaError(false)]),
      503,
      /^Knowledge search is temporarily/,
    ],
    [
      'a workspace key out of quota ahead of an exhausted platform fallback',
      new AggregateError([quotaError(true), quotaError(false)]),
      503,
      /this workspace's embedding API key/,
    ],
    [
      'a keyless Ollama server out of quota',
      quotaError(true, 'ollama'),
      503,
      /^Knowledge search is temporarily/,
    ],
    [
      'a rejected workspace key',
      new EmbeddingAPIError('Embedding API failed: 401', 401, true),
      502,
      /was rejected/,
    ],
    ['the retrieval deadline', new SearchDeadlineError(), 504, /retrieval deadline/],
  ])('names %s', (_case, error, status, message) => {
    const response = internalKnowledgeErrorPolicies.search.project(error)
    expect(response?.status).toBe(status)
    expect((response?.body as { error: string }).error).toMatch(message)
  })

  it('leaves a platform key rejection and unknown failures to the generic server error', () => {
    const policy = internalKnowledgeErrorPolicies.search
    expect(
      policy.project(new EmbeddingAPIError('Embedding API failed: 401', 401, false))
    ).toBeNull()
    expect(policy.project(new Error('connection reset'))).toBeNull()
    expect(policy.unhandled?.()).toMatchObject({
      status: 500,
      body: { error: 'Failed to perform vector search' },
    })
  })
})

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
