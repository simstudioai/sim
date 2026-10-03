import { vi } from 'vitest'

interface MockResourceOwner {
  workspaceId?: string | null
  organizationId?: string | null
}

const mockResolveKnowledgeWorkspaceContext = vi.fn()

const mockResolveKnowledgeOrganizationContext = vi.fn(
  async ({ organizationId }: { organizationId: string }): Promise<unknown> => ({
    organizationId,
    workspaceId: undefined,
  })
)

/**
 * Controllable mock functions for `@/lib/knowledge/application/contexts`.
 *
 * Defaults:
 * - `mockResolveKnowledgeOrganizationContext` resolves `{ organizationId, workspaceId: undefined }`
 *   (the real result for an existing organization).
 * - `mockResolveKnowledgeOwnerContext` routes exactly like production: a workspace-only owner goes
 *   to `mockResolveKnowledgeWorkspaceContext`, an organization-only owner to
 *   `mockResolveKnowledgeOrganizationContext`, anything else throws.
 * - Everything else is a bare `vi.fn()` (resolves `undefined`).
 *
 * @example
 * ```ts
 * import { knowledgeContextsMockFns } from '@sim/testing/mocks/knowledge-contexts.mock'
 *
 * knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext.mockResolvedValue({
 *   workspaceId: 'ws-1', workspaceOrganizationId: null, allowPersonalApiKeys: true,
 *   billedAccountUserId: 'user-1',
 * })
 * ```
 */
export const knowledgeContextsMockFns = {
  mockResolveKnowledgeOrganizationContext,
  mockLoadKnowledgeWorkspaceContext: vi.fn(),
  mockLoadKnowledgeWorkspaceAuthorizationContext: vi.fn(),
  mockResolveKnowledgeWorkspaceContext,
  mockResolveActiveKnowledgeBaseContext: vi.fn(),
  mockResolveActiveKnowledgeBaseInWorkspace: vi.fn(),
  mockResolveArchivedKnowledgeBaseContext: vi.fn(),
  mockResolveActiveKnowledgeResourceContext: vi.fn(),
  mockResolveActiveKnowledgeDocumentContext: vi.fn(),
  mockResolveCanonicalActiveKnowledgeDocumentContext: vi.fn(),
  mockResolveActiveKnowledgeChunkContext: vi.fn(),
  mockResolveActiveKnowledgeTagContext: vi.fn(),
  mockResolveActiveKnowledgeConnectorContext: vi.fn(),
  mockResolveKnowledgeOwnerContext: vi.fn((owner: MockResourceOwner): Promise<unknown> => {
    const { workspaceId, organizationId } = owner
    if (workspaceId && !organizationId) {
      return mockResolveKnowledgeWorkspaceContext({ workspaceId })
    }
    if (organizationId && !workspaceId) {
      return mockResolveKnowledgeOrganizationContext({ organizationId })
    }
    throw new Error('Resource requires exactly one workspace or organization owner')
  }),
}

/**
 * Static mock module for `@/lib/knowledge/application/contexts`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/application/contexts', () => knowledgeContextsMock)
 * ```
 */
export const knowledgeContextsMock = {
  resolveKnowledgeOrganizationContext:
    knowledgeContextsMockFns.mockResolveKnowledgeOrganizationContext,
  loadKnowledgeWorkspaceContext: knowledgeContextsMockFns.mockLoadKnowledgeWorkspaceContext,
  loadKnowledgeWorkspaceAuthorizationContext:
    knowledgeContextsMockFns.mockLoadKnowledgeWorkspaceAuthorizationContext,
  resolveKnowledgeWorkspaceContext: knowledgeContextsMockFns.mockResolveKnowledgeWorkspaceContext,
  resolveActiveKnowledgeBaseContext: knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseContext,
  resolveActiveKnowledgeBaseInWorkspace:
    knowledgeContextsMockFns.mockResolveActiveKnowledgeBaseInWorkspace,
  resolveArchivedKnowledgeBaseContext:
    knowledgeContextsMockFns.mockResolveArchivedKnowledgeBaseContext,
  resolveActiveKnowledgeResourceContext:
    knowledgeContextsMockFns.mockResolveActiveKnowledgeResourceContext,
  resolveActiveKnowledgeDocumentContext:
    knowledgeContextsMockFns.mockResolveActiveKnowledgeDocumentContext,
  resolveCanonicalActiveKnowledgeDocumentContext:
    knowledgeContextsMockFns.mockResolveCanonicalActiveKnowledgeDocumentContext,
  resolveActiveKnowledgeChunkContext:
    knowledgeContextsMockFns.mockResolveActiveKnowledgeChunkContext,
  resolveActiveKnowledgeTagContext: knowledgeContextsMockFns.mockResolveActiveKnowledgeTagContext,
  resolveActiveKnowledgeConnectorContext:
    knowledgeContextsMockFns.mockResolveActiveKnowledgeConnectorContext,
  resolveKnowledgeOwnerContext: knowledgeContextsMockFns.mockResolveKnowledgeOwnerContext,
}
