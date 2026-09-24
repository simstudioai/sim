import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { OrchestrationError } from '@/lib/core/orchestration/types'
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

export type SearchWorkspaceKnowledgeInput = Omit<
  SearchKnowledgeInput,
  'knowledgeBaseIds' | 'workspaceId'
> & {
  workspaceId: string
}

export type SearchOrganizationKnowledgeInput = Omit<
  SearchWorkspaceKnowledgeInput,
  'workspaceId'
> & { organizationId: string }

export type SearchScopedKnowledgeInput = Omit<
  SearchKnowledgeInput,
  'knowledgeBaseIds' | 'workspaceId' | 'organizationId'
> &
  ResourceOwner

/** What an owner without an index answers: nothing, completely. */
interface SearchWithoutIndex {
  results: []
  query: string
  knowledgeBases: []
  retrieval: { status: 'complete'; timedOutLegs: [] }
}

type ScopedSearchResult = SearchKnowledgeResult | SearchWithoutIndex

/** Whether an index was searched, which is what the follow-up to a search is for. */
function searchedAnIndex(result: ScopedSearchResult): result is SearchKnowledgeResult {
  return 'knowledgeBaseId' in result
}

/**
 * An owner without an index answers empty. An organization still has to be allowed to search,
 * and its empty search is recorded like any other, so the activity view shows the attempt.
 */
async function searchWithoutIndex(
  principal: Principal,
  context: KnowledgeResourceContext,
  input: Pick<SearchKnowledgeInput, 'query' | 'surface' | 'signal'>
): Promise<SearchWithoutIndex> {
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
  return {
    results: [],
    query: input.query ?? '',
    knowledgeBases: [],
    retrieval: { status: 'complete', timedOutLegs: [] },
  }
}

type ScopedSearchInput = Omit<SearchKnowledgeInput, 'knowledgeBaseIds'>

/**
 * A search surface that resolves an owner, finds the owner's index and searches it. The owner is
 * resolved and authorized once, here; the search runs under that context, and nothing about the
 * index is read twice. Surfaces differ only in how they name the owner and find the index.
 */
function defineScopedSearchUseCase<
  I extends Pick<SearchKnowledgeInput, 'query' | 'surface' | 'signal' | 'filters'>,
>(surface: {
  resolveContext: (input: I) => Promise<KnowledgeResourceContext>
  findIndex: (context: KnowledgeResourceContext) => Promise<ActiveKnowledgeBaseReference | null>
  searchInput: (input: I, context: KnowledgeResourceContext) => ScopedSearchInput
}) {
  return defineAuthorizedKnowledgeUseCase({
    operation: knowledgeOperations.search,
    resolveContext: ({ input }: { input: I }) =>
      measureSearchStage('scope_resolution', () => surface.resolveContext(input)),
    async execute({ principal, input, context }): Promise<ScopedSearchResult> {
      input.signal?.throwIfAborted()
      if (
        !input.query?.trim() ||
        input.filters?.startDate ||
        input.filters?.endDate ||
        input.filters?.sortBy
      )
        throw new OrchestrationError(
          'validation',
          'Date-only search, startDate/endDate and sorting require live search. Use a text query and modification filters for indexed search.'
        )
      const index = await measureSearchStage('index_resolution', () => surface.findIndex(context))
      if (!index) return searchWithoutIndex(principal, context, input)
      const searchInput: SearchKnowledgeInput = {
        ...surface.searchInput(input, context),
        knowledgeBaseIds: [index.id],
      }
      /** An owner the request asserts is the one that was resolved, or the request names none. */
      if (
        (searchInput.organizationId && searchInput.organizationId !== context.organizationId) ||
        (searchInput.workspaceId && searchInput.workspaceId !== context.workspaceId)
      ) {
        throw new OrchestrationError('not_found', 'Knowledge base not found')
      }
      validateKnowledgeSearchInput(searchInput)
      return runKnowledgeSearch({
        principal,
        input: searchInput,
        context: buildKnowledgeSearchContext(principal, context, [index], searchInput),
      })
    },
    afterSuccess: ({ principal, context, input, result }) =>
      searchedAnIndex(result)
        ? afterKnowledgeSearch({ principal, context, input, result })
        : undefined,
  })
}

/** Search and Assistant share the workspace's canonical Enterprise Search index. */
export const searchWorkspaceKnowledge = instrumentSearchUseCase(
  'workspace_application',
  defineScopedSearchUseCase<SearchWorkspaceKnowledgeInput>({
    resolveContext: (input) => resolveKnowledgeWorkspaceContext(input),
    findIndex: (context) => findWorkspaceSearchIndex(context.workspaceId!),
    searchInput: (input, context) => ({ ...input, workspaceId: context.workspaceId }),
  })
)

/** Organization Search and Assistant resolve the same index and provider ACLs. */
export const searchOrganizationKnowledge = instrumentSearchUseCase(
  'organization_application',
  defineScopedSearchUseCase<SearchOrganizationKnowledgeInput>({
    resolveContext: (input) => resolveKnowledgeOrganizationContext(input),
    findIndex: (context) =>
      findSearchIndex({ kind: 'organization', organizationId: context.organizationId! }),
    searchInput: (input) => input,
  })
)

/** The routed owner selects the index; current membership and provider ACLs select its documents. */
export const searchScopedKnowledge = instrumentSearchUseCase(
  'scoped_application',
  defineScopedSearchUseCase<SearchScopedKnowledgeInput>({
    resolveContext: (input) => resolveKnowledgeOwnerContext(input),
    findIndex: (context) => findSearchIndex(resourceScopeFromOwner(context)),
    searchInput: (input) => ({
      ...input,
      workspaceId: input.workspaceId ?? undefined,
      organizationId: input.organizationId ?? undefined,
    }),
  })
)
