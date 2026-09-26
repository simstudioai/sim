import type { KnowledgeAccessProvider, UserAccessScope } from '@/lib/knowledge/access/types'
import type { SearchBudget } from '@/lib/knowledge/search/budget'
import {
  liveSourceAccessForConnectors,
  type RetrievalLegs,
  type SearchParams,
  type SearchResult,
  VECTOR_PROBE_BUDGET_MS,
  VECTOR_PROBE_DOCUMENT_LIMIT,
} from '@/lib/knowledge/search/candidates'
import { measureSearchStage } from '@/lib/knowledge/search/diagnostics'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import { selectAuthorizedTagResults } from '@/lib/knowledge/search/tag-filters'
import { assertIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'
import {
  resolveSearchAccessPlan,
  restrictSearchAccessPlan,
} from '@/lib/sim-search/indexed/retrieval/access-plan'
import { executeIndexedKeywordSearch } from '@/lib/sim-search/indexed/retrieval/keyword'
import {
  estimateFilteredDocuments,
  type IndexedRetrievalContext,
  isSearchFiltered,
  type PermittedDocuments,
  resolvePermittedDocuments,
  resolveReach,
} from '@/lib/sim-search/indexed/retrieval/permitted'
import { knowledgeCandidateAccessConditionForConnectors } from '@/lib/sim-search/indexed/retrieval/projection-access'
import { selectIndexedVectorResults } from '@/lib/sim-search/indexed/retrieval/vector'

/**
 * The tag-only leg of a user-scoped search-index search: candidate identities under the caller's
 * resolved plan, in id order, hydrated under the full read predicate once live source proof is
 * known.
 */
export function selectIndexedTagResults(
  params: SearchParams,
  context: IndexedRetrievalContext
): Promise<SearchResult[]> {
  if (!params.structuredFilters || params.structuredFilters.length === 0) {
    throw new Error('Tag filters are required for tag-only search')
  }
  return selectAuthorizedTagResults(
    params,
    knowledgeCandidateAccessConditionForConnectors(context.access, context.accessPlan),
    context.liveSourceAccess
  )
}

/**
 * Resolves what a user-scoped search over search indexes needs before any leg ranks, and binds it
 * to the search-index legs. Connector state is the same for every document a connector owns, so
 * every leg reads it from one resolution instead of proving it per candidate. A source filter
 * confines the plan rather than the rows: with only that kind of source eligible, every predicate
 * the plan builds and every source the legs walk is that kind.
 *
 * A ranked search also resolves, once and on the vector leg's budget, what the caller may read.
 * A filter that leaves few documents is enumerated and ranked exactly inside them, both legs: the
 * row does not carry the document's date, and a keyword ranking of the whole base may hold few of
 * a small source's matches. A filter that leaves many is ranked as the scope is — the source
 * confined on the row, the date tested through the document — since a set that large holds most
 * of the query's neighbours anyway. The planner's estimate decides which. Otherwise readability is
 * decided on the projection row, so the caller's reach alone chooses between one walk over the
 * whole graph and a search of each source. Explicit documents are already a bounded scope with
 * their own exhaustive ordering.
 */
export async function prepareIndexedRetrieval(input: {
  knowledgeBaseIds: string[]
  access: UserAccessScope
  accessProvider: KnowledgeAccessProvider
  filters?: WorkspaceSearchFilters
  signal?: AbortSignal
  /** Whether the search ranks a query; a tag-only search needs no permitted set. */
  ranked: boolean
  /** The vector leg's budget, which resolving the permitted set spends. */
  budget: SearchBudget
}): Promise<RetrievalLegs> {
  assertIndexedOrgSearchEnabled()
  const { knowledgeBaseIds, access, filters } = input
  const resolvedPlan = await measureSearchStage('access_plan', () =>
    resolveSearchAccessPlan(knowledgeBaseIds, access)
  )
  const accessPlan = filters?.source
    ? restrictSearchAccessPlan(resolvedPlan, filters.source)
    : resolvedPlan
  const liveSourceAccess = liveSourceAccessForConnectors(
    accessPlan.connectors.liveProofRequired,
    input.accessProvider,
    input.signal
  )
  const filtered = isSearchFiltered(filters)
  let permitted: PermittedDocuments | undefined
  if (input.ranked && !filters?.documentIds?.length) {
    /** Planning only, so a short cap of its own: running past it answers as the wide window it may be. */
    const estimateBudget = input.budget.capped(VECTOR_PROBE_BUDGET_MS)
    const enumerateFiltered =
      filters && filtered
        ? await estimateFilteredDocuments(knowledgeBaseIds, filters, accessPlan, estimateBudget)
            .then((estimate) => estimate <= VECTOR_PROBE_DOCUMENT_LIMIT)
            .catch((error) => {
              if (!estimateBudget.isTimeout(error)) throw error
              return false
            })
        : false
    permitted = enumerateFiltered
      ? await resolvePermittedDocuments({
          knowledgeBaseIds,
          access,
          filters,
          budget: input.budget,
          accessPlan,
          filtered,
        })
      : await resolveReach(knowledgeBaseIds, access, input.budget, accessPlan)
  }
  const context: IndexedRetrievalContext = {
    access,
    accessPlan,
    filtered,
    permitted,
    liveSourceAccess,
  }
  return {
    tags: (params) => selectIndexedTagResults(params, context),
    vector: (params) => selectIndexedVectorResults(params, context),
    keyword: (params) => executeIndexedKeywordSearch(params, context),
  }
}
