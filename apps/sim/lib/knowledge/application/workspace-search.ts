import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import {
  type KnowledgeResourceContext,
  resolveKnowledgeOrganizationContext,
  resolveKnowledgeOwnerContext,
  resolveKnowledgeWorkspaceContext,
} from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  afterKnowledgeSearch,
  buildKnowledgeSearchContext,
  runKnowledgeSearch,
  type SearchKnowledgeInput,
  type SearchKnowledgeResult,
  validateKnowledgeSearchInput,
} from '@/lib/knowledge/application/search'
import { instrumentSearchUseCase } from '@/lib/knowledge/application/search-diagnostics'
import type { ActiveKnowledgeBaseReference } from '@/lib/knowledge/knowledge-base-reference'
import { recordOrganizationSearchActivity } from '@/lib/knowledge/search/activity'
import { measureSearchStage } from '@/lib/knowledge/search/diagnostics'
import { findSearchIndex, findWorkspaceSearchIndex } from '@/lib/knowledge/search/search-index'

/** A search's result when the owner has an index; an owner without one answers empty. */
type ScopedSearchResult =
  | SearchKnowledgeResult
  | {
      results: []
      query: string
      knowledgeBases: []
      retrieval: { status: 'complete'; timedOutLegs: [] }
    }

function emptySearch(query: string | undefined): ScopedSearchResult {
  return {
    results: [],
    query: query ?? '',
    knowledgeBases: [],
    retrieval: { status: 'complete' as const, timedOutLegs: [] },
  }
}

/**
 * Runs the search over the owner's index under the context this use case already resolved and
 * authorized: the index is the one base, and nothing about it is read twice.
 */
function searchOwnersIndex(
  principal: Principal,
  input: Omit<SearchKnowledgeInput, 'knowledgeBaseIds'>,
  context: KnowledgeResourceContext,
  index: ActiveKnowledgeBaseReference
): Promise<SearchKnowledgeResult> {
  const searchInput: SearchKnowledgeInput = { ...input, knowledgeBaseIds: [index.id] }
  validateKnowledgeSearchInput(searchInput)
  return runKnowledgeSearch({
    principal,
    input: searchInput,
    context: buildKnowledgeSearchContext(principal, context, [index], input.signal),
  })
}

/** The shared follow-up applies to a search that ran; an empty answer recorded its own. */
function afterScopedSearch(execution: {
  principal: Principal
  context: KnowledgeResourceContext
  input: Pick<SearchKnowledgeInput, 'surface'>
  result: ScopedSearchResult
}): Promise<void> | undefined {
  return 'userId' in execution.result
    ? afterKnowledgeSearch({ ...execution, result: execution.result })
    : undefined
}

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
    if (!index) return emptySearch(input.query)
    return searchOwnersIndex(
      principal,
      { ...input, workspaceId: context.workspaceId },
      context,
      index
    )
  },
  afterSuccess: ({ principal, context, input, result }) =>
    afterScopedSearch({ principal, context, input, result }),
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
      return emptySearch(input.query)
    }
    return searchOwnersIndex(principal, input, context, index)
  },
  afterSuccess: ({ principal, context, input, result }) =>
    afterScopedSearch({ principal, context, input, result }),
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
      return emptySearch(input.query)
    }
    return searchOwnersIndex(
      principal,
      {
        ...input,
        workspaceId: input.workspaceId ?? undefined,
        organizationId: input.organizationId ?? undefined,
      },
      context,
      index
    )
  },
  afterSuccess: ({ principal, context, input, result }) =>
    afterScopedSearch({ principal, context, input, result }),
})

export const searchScopedKnowledge = instrumentSearchUseCase(
  'scoped_application',
  searchScopedKnowledgeUseCase
)
