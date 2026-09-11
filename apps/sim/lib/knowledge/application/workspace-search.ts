import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  resolveKnowledgeOrganizationContext,
  resolveKnowledgeOwnerContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { type SearchKnowledgeInput, searchKnowledge } from '@/lib/knowledge/application/search'
import { instrumentSearchUseCase } from '@/lib/knowledge/application/search-diagnostics'
import { recordOrganizationSearchActivity } from '@/lib/knowledge/search/activity'
import { measureSearchStage } from '@/lib/knowledge/search/diagnostics'
import { findSearchIndex, findWorkspaceSearchIndex } from '@/lib/knowledge/search/search-index'

export type SearchWorkspaceKnowledgeInput = Omit<
  SearchKnowledgeInput,
  'knowledgeBaseIds' | 'workspaceId'
> & {
  workspaceId: string
}

/** Search and Assistant share the workspace's canonical Enterprise Search index. */
const searchWorkspaceKnowledgeUseCase = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: SearchWorkspaceKnowledgeInput }) =>
    measureSearchStage('scope_resolution', () => resolveKnowledgeWorkspaceContext(input)),
  async execute({ principal, input, context }) {
    input.signal?.throwIfAborted()
    const index = await measureSearchStage('index_resolution', () =>
      findWorkspaceSearchIndex(context.workspaceId)
    )
    if (!index) return { results: [], query: input.query ?? '', knowledgeBases: [] }
    return searchKnowledge.execute({
      principal,
      input: { ...input, workspaceId: context.workspaceId, knowledgeBaseIds: [index.id] },
    })
  },
})

export const searchWorkspaceKnowledge = instrumentSearchUseCase(
  'workspace_application',
  searchWorkspaceKnowledgeUseCase
)

export type SearchOrganizationKnowledgeInput = Omit<
  SearchWorkspaceKnowledgeInput,
  'workspaceId'
> & { organizationId: string }

/** Organization Search and Assistant resolve the same index and provider ACLs. */
const searchOrganizationKnowledgeUseCase = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: SearchOrganizationKnowledgeInput }) =>
    measureSearchStage('scope_resolution', () => resolveKnowledgeOrganizationContext(input)),
  async execute({ principal, input, context }) {
    input.signal?.throwIfAborted()
    const index = await measureSearchStage('index_resolution', () =>
      findSearchIndex({
        kind: 'organization',
        organizationId: context.organizationId,
      })
    )
    if (!index) {
      if (context.organizationId) {
        await requireOrganizationSearchAvailable(context.organizationId)
        input.signal?.throwIfAborted()
        const userId = resolvePrincipalSubjectUserId(principal)
        if (userId)
          await recordOrganizationSearchActivity({
            organizationId: context.organizationId,
            userId,
            surface: input.surface ?? 'other',
            results: [],
          })
      }
      return { results: [], query: input.query ?? '', knowledgeBases: [] }
    }
    return searchKnowledge.execute({
      principal,
      input: { ...input, knowledgeBaseIds: [index.id] },
    })
  },
})

export const searchOrganizationKnowledge = instrumentSearchUseCase(
  'organization_application',
  searchOrganizationKnowledgeUseCase
)

export type SearchScopedKnowledgeInput = Omit<
  SearchKnowledgeInput,
  'knowledgeBaseIds' | 'workspaceId' | 'organizationId'
> &
  ResourceOwner

/** The routed owner selects the index; current membership and provider ACLs select its documents. */
const searchScopedKnowledgeUseCase = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: SearchScopedKnowledgeInput }) =>
    measureSearchStage('scope_resolution', () => resolveKnowledgeOwnerContext(input)),
  async execute({ principal, input, context }) {
    input.signal?.throwIfAborted()
    const index = await measureSearchStage('index_resolution', () =>
      findSearchIndex(resourceScopeFromOwner(context))
    )
    if (!index) {
      if (context.organizationId) {
        await requireOrganizationSearchAvailable(context.organizationId)
        input.signal?.throwIfAborted()
        const userId = resolvePrincipalSubjectUserId(principal)
        if (userId)
          await recordOrganizationSearchActivity({
            organizationId: context.organizationId,
            userId,
            surface: input.surface ?? 'other',
            results: [],
          })
      }
      return { results: [], query: input.query ?? '', knowledgeBases: [] }
    }
    return searchKnowledge.execute({
      principal,
      input: {
        ...input,
        workspaceId: input.workspaceId ?? undefined,
        organizationId: input.organizationId ?? undefined,
        knowledgeBaseIds: [index.id],
      },
    })
  },
})

export const searchScopedKnowledge = instrumentSearchUseCase(
  'scoped_application',
  searchScopedKnowledgeUseCase
)
