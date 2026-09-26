import { document } from '@sim/db/schema'
import { sha256Hex } from '@sim/security/hash'
import { and, inArray, isNull, type SQL, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import { LRUCache } from 'lru-cache'
import { textArrayLiteral } from '@/lib/knowledge/access/predicate'
import type { UserAccessScope } from '@/lib/knowledge/access/types'
import { runSearchQuery, type SearchBudget } from '@/lib/knowledge/search/budget'
import {
  candidateDocumentConditions,
  directVisibleDocumentsQuery,
  type LiveSourceAccess,
  type PermittedDocument,
  type ProbeOutcome,
  probeVisibleDocuments,
  VECTOR_PROBE_BUDGET_MS,
  VECTOR_PROBE_DOCUMENT_LIMIT,
} from '@/lib/knowledge/search/candidates'
import { annotateSearchDiagnostics } from '@/lib/knowledge/search/diagnostics'
import { searchDateFilterCondition } from '@/lib/knowledge/search/filter-conditions'
import type { WorkspaceSearchFilters } from '@/lib/knowledge/search/filters'
import type { SearchAccessPlan } from '@/lib/sim-search/indexed/retrieval/access-plan'
import {
  knowledgeAclOverlapCondition,
  knowledgeCandidateAccessConditionForConnectors,
} from '@/lib/sim-search/indexed/retrieval/projection-access'

/**
 * What a filter-first probe may spend: it reads the filtered documents off their own index and
 * tests each one's access, bounded by the same document limit, and measures around 2 µs per
 * document to enumerate plus the access test — a window at the limit fits with room. Its result
 * is ranked exactly, at a cost that is predictable where a walk through a mostly-excluded
 * neighbourhood is not.
 */
const FILTERED_PROBE_BUDGET_MS = 1500

/**
 * Whether a filter narrows the documents in a way the projection row cannot see — a date window,
 * or a source kind, which confines the plan — so the filtered set is worth estimating and, when
 * small, enumerating directly.
 */
export function isSearchFiltered(filters: WorkspaceSearchFilters | undefined): boolean {
  return Boolean(searchDateFilterCondition(filters) || filters?.source)
}

/** A row whose document satisfies `condition`; nothing when there is nothing to ask the document. */
export function documentSatisfies(
  documentId: AnyPgColumn | SQL,
  condition: SQL | undefined
): SQL | undefined {
  if (condition === undefined) return undefined
  return sql`EXISTS (SELECT 1 FROM ${document} WHERE ${and(sql`${document.id} = ${documentId}`, condition)})`
}

/**
 * Documents a bounded permitted set may hold before ranking it exactly costs more than walking
 * the graph on the row. Exact ranking reads every chunk of the set, a few per document, where an
 * on-row walk reads at most a capped number of tuples; at this size the two meet. A set past it
 * is walked first and ranked exactly only if the walk cannot fill its pool, so its recall is never
 * below the exact ranking's and its usual cost is the walk's. The same size turns the keyword leg
 * from a read of the set's every chunk into a ranking decided on the row.
 */
export const PERMITTED_EXACT_DOCUMENT_LIMIT = 5_000

/**
 * The documents a user-scoped search-index search may rank, resolved once before either leg runs.
 *
 * Organization search indexes grant most documents to a single mailbox, channel, or file owner,
 * so a member typically reads a vanishing share of the index. Ranking the whole index and
 * checking access afterwards then scans thousands of candidates to find none; ranking inside the
 * permitted set finds every eligible chunk at a cost proportional to what the member can read.
 * `unbounded` means the set exceeded the probe's limit, where post-filtered index search fills
 * quickly because most candidates are readable.
 */
export type PermittedDocuments =
  | { kind: 'bounded'; documents: readonly PermittedDocument[] }
  | { kind: 'unbounded'; broad: boolean }

/**
 * The share of the index a caller must reach before the whole graph is walked for them. pgvector
 * post-filters, so a walk returns a caller's own neighbours in proportion to their reach: above
 * this share almost every neighbour the graph visits is theirs and one walk is the cheapest exact
 * answer there is; below it the walk spends its budget on chunks they cannot read, and each
 * readable source is searched on its own instead.
 */
const BROAD_REACH_SHARE = 0.25

/**
 * How long a caller's saturated reach is remembered. Reach counts the documents a caller's tokens
 * touch in the bases, which moves slowly, and an unbounded set only means the legs search the
 * index with the full access predicate, so a stale answer costs speed, never access.
 */
const SATURATED_REACH_TTL_MS = 5 * 60 * 1000

/**
 * A counted reach: whether it is broad enough to walk the whole graph for, or empty, in which
 * case the caller reads nothing in these bases and no leg has anything to rank.
 */
interface CountedReach {
  broad: boolean
  empty: boolean
}

/**
 * Only breadth is remembered. Emptiness decides completeness, not strategy, so it is counted on
 * every search: the count of a reach of nothing finds nothing and costs almost nothing.
 */
const saturatedReach = new LRUCache<string, { broad: boolean }>({
  max: 10_000,
  ttl: SATURATED_REACH_TTL_MS,
})

/** How many documents the bases hold: the denominator of a reach share, and it moves slowly. */
const indexDocumentCounts = new LRUCache<string, number, SearchBudget | undefined>({
  max: 1000,
  ttl: SATURATED_REACH_TTL_MS,
  /**
   * The planner's estimate of the bases' documents, from the statistics it already keeps: a share
   * threshold needs the order of magnitude, and counting every row to learn it costs more than the
   * search it serves. The read that misses is the search's own, under its deadline.
   */
  fetchMethod: async (key, _stale, { context: budget }) => {
    const [row] = await runSearchQuery(budget, 'permitted_documents', (executor) =>
      executor.execute<{ 'QUERY PLAN': Array<{ Plan: { 'Plan Rows': number } }> }>(sql`
      EXPLAIN (FORMAT JSON) SELECT 1 FROM ${document}
      WHERE ${document.knowledgeBaseId} = ANY(${textArrayLiteral(key.split(','))})
        AND ${document.deletedAt} IS NULL`)
    )
    /** An empty answer is not remembered; the bases may simply not have been analyzed yet. */
    return Number(row?.['QUERY PLAN']?.[0]?.Plan?.['Plan Rows'] ?? 0) || undefined
  },
})

/**
 * The permitted-set probe's SQL, returning at most one row past the document limit.
 *
 * A user scope first materializes the documents its tokens reach in these bases, read through
 * `doc_acl_gin_idx` alone, then applies the state and full access conditions to those rows in
 * memory; the set is aliased as `document` so the shared conditions bind to it unchanged. Handed
 * the combined predicate instead, PostgreSQL misjudges the token overlap as unselective and
 * intersects it with base-wide indexes that read the whole search index.
 *
 * The index is global and every caller holds the baseline tokens every tenant's org-wide, public,
 * and uploaded documents carry, so the reach must be counted inside these bases or those
 * documents alone would saturate it. The base check is applied outside an `OFFSET 0` fence so it
 * filters the index's rows instead of replacing the index with a base-wide scan. The reach is
 * counted before any row is materialized, so a caller whose tokens reach past the limit pays only
 * for the count, and a `saturated` sentinel row then reports the set as unbounded. Resolved scopes
 * hold base-wide tokens, so they filter directly.
 */
function visibleDocumentsQuery(
  knowledgeBaseIds: string[],
  conditions: (SQL | undefined)[],
  access: UserAccessScope,
  shape: 'reach-first' | 'direct' = 'reach-first'
): SQL {
  const limit = VECTOR_PROBE_DOCUMENT_LIMIT + 1
  /**
   * `direct` applies the conditions as they are: a date filter is selective on its own and has
   * its own index, so counting the reach first would only report a broad caller as saturated
   * before the filter was consulted.
   */
  if (shape === 'direct') return directVisibleDocumentsQuery(conditions)
  /** Exactly `doc_acl_gin_idx`'s predicate, so both the count and the rows read that index alone. */
  const reached = sql`${document.deletedAt} IS NULL AND ${knowledgeAclOverlapCondition(access)}`
  const underLimit = sql`(SELECT n FROM reach) < ${limit}`
  const inBases = inArray(document.knowledgeBaseId, knowledgeBaseIds)
  return sql`
    WITH reach AS MATERIALIZED (
      SELECT count(*) AS n FROM (
        SELECT 1 FROM (
          SELECT ${document.knowledgeBaseId} FROM ${document} WHERE ${reached} OFFSET 0
        ) AS ${document}
        WHERE ${inBases}
        LIMIT ${limit}
      ) AS reached
    ), reachable AS MATERIALIZED (
      SELECT * FROM (
        SELECT * FROM ${document} WHERE ${underLimit} AND ${reached} OFFSET 0
      ) AS ${document}
      WHERE ${inBases}
    )
    (
      SELECT ${document.id} AS id, ${document.connectorId} AS "connectorId", false AS saturated
      FROM reachable AS ${document}
      WHERE ${underLimit} AND ${and(...conditions)}
      LIMIT ${limit}
    )
    UNION ALL
    SELECT NULL, NULL, true WHERE (SELECT n FROM reach) >= ${limit}
  `
}

/**
 * The planner's estimate of the documents a filter leaves in the bases — a date filter from the
 * statistics on its index, a source filter from its connectors' — so whether the filtered set is
 * worth enumerating is decided from its order of magnitude, without reading a row.
 */
export async function estimateFilteredDocuments(
  knowledgeBaseIds: string[],
  filters: WorkspaceSearchFilters,
  plan: SearchAccessPlan,
  budget: SearchBudget | undefined
): Promise<number> {
  const [row] = await runSearchQuery(budget, 'permitted_documents', (executor) =>
    executor.execute<{ 'QUERY PLAN': Array<{ Plan: { 'Plan Rows': number } }> }>(sql`
    EXPLAIN (FORMAT JSON) SELECT 1 FROM ${document}
    WHERE ${and(
      inArray(document.knowledgeBaseId, knowledgeBaseIds),
      isNull(document.deletedAt),
      searchDateFilterCondition(filters),
      filters.source ? planSourceCondition(plan) : undefined
    )}`)
  )
  return Number(row?.['QUERY PLAN']?.[0]?.Plan?.['Plan Rows'] ?? 0)
}

/**
 * How far a caller reaches: broad when they reach at least {@link BROAD_REACH_SHARE} of the
 * bases' documents, empty when they reach none. A reach of nothing is a bounded set of nothing: a
 * caller who reads no document in these bases, such as a member with no source of their own yet,
 * has nothing for any leg to rank, where an unbounded set would have each leg scan to its
 * deadline for rows it cannot find. Breadth is counted once against the bound and remembered, so
 * the first search after the window pays for it and the rest do not. A caller whose probe already
 * saturated is known to reach past the probe's limit, so a bound inside that limit is met without
 * counting.
 *
 * The count reads as many index entries as the caller reaches, so on a large index it can cost
 * more than the leg it serves; it gets the probe's share of the deadline, never the whole leg's.
 * A count that runs out of that share answers `null`: the leg keeps its time and its deadline
 * intact, and the caller decides this search alone without remembering anything.
 */
async function countReach(
  knowledgeBaseIds: string[],
  access: UserAccessScope,
  budget: SearchBudget | undefined,
  plan: SearchAccessPlan,
  saturated: boolean
): Promise<CountedReach | null> {
  const countBudget = budget?.capped(VECTOR_PROBE_BUDGET_MS)
  try {
    const total =
      (await indexDocumentCounts.fetch([...knowledgeBaseIds].sort().join(','), {
        context: countBudget,
      })) ?? 0
    const bound = Math.ceil(total * BROAD_REACH_SHARE)
    if (saturated && bound <= VECTOR_PROBE_DOCUMENT_LIMIT) return { broad: true, empty: false }
    const [row] = await runSearchQuery(countBudget, 'permitted_documents', (executor) =>
      executor.execute<{ n: number }>(sql`
        SELECT count(*) AS n FROM (
          SELECT 1 FROM ${document}
          WHERE ${and(
            isNull(document.deletedAt),
            knowledgeAclOverlapCondition(access),
            inArray(document.knowledgeBaseId, knowledgeBaseIds),
            planSourceCondition(plan)
          )}
          LIMIT ${bound}
        ) reached`)
    )
    const reached = Number(row?.n ?? 0)
    /** A count that looked and found nothing: only a bound of zero looks at nothing. */
    return { broad: reached >= bound, empty: bound > 0 && reached === 0 }
  } catch (error) {
    if (!budget || !countBudget?.isTimeout(error)) throw error
    /** Only the count's share was spent; the leg's own deadline still governs. */
    budget.remaining()
    return null
  }
}

/**
 * Reach depends on the bases, the caller's tokens and, when the plan is confined to one kind of
 * source, which sources those are; a date filter narrows the set, not the reach.
 */
function reachKey(
  knowledgeBaseIds: readonly string[],
  access: UserAccessScope,
  plan: SearchAccessPlan
): string {
  const sources = `:${sha256Hex([...planSources(plan)].sort().join('\n'))}:${plan.uploads}`
  return `${[...knowledgeBaseIds].sort().join(',')}:${sha256Hex([...access.tokens].sort().join('\n'))}${sources}`
}

/** Every connector the plan admits, whatever its access mode. */
function planSources(plan: SearchAccessPlan): readonly string[] {
  return [...plan.connectors.workspace, ...plan.connectors.admin, ...plan.connectors.members]
}

/** The documents a plan's sources own, on the document row; every source when unconfined. */
function planSourceCondition(plan: SearchAccessPlan): SQL {
  const owned = planSources(plan)
  const inSources = owned.length
    ? sql`${document.connectorId} = ANY(${textArrayLiteral([...owned])})`
    : sql`false`
  return plan.uploads ? sql`(${document.connectorId} IS NULL OR ${inSources})` : inSources
}

/** Forgets every remembered reach, after the bases' documents or a caller's tokens changed. */
export function forgetSearchReach(): void {
  saturatedReach.clear()
  indexDocumentCounts.clear()
}

/** A resolved scope's reach, remembered per bases and tokens, with no document enumerated. */
export async function resolveReach(
  knowledgeBaseIds: string[],
  access: UserAccessScope,
  budget: SearchBudget | undefined,
  plan: SearchAccessPlan
): Promise<PermittedDocuments> {
  const key = reachKey(knowledgeBaseIds, access, plan)
  const remembered = saturatedReach.get(key)
  if (remembered) return { kind: 'unbounded', broad: remembered.broad }
  try {
    const reach = await countReach(knowledgeBaseIds, access, budget, plan, false)
    /** A count that ran out of time decides this search only; the next one counts again. */
    if (reach === null) return { kind: 'unbounded', broad: true }
    if (reach.empty) return { kind: 'bounded', documents: [] }
    saturatedReach.set(key, { broad: reach.broad })
    return { kind: 'unbounded', broad: reach.broad }
  } catch (error) {
    /** The leg's own deadline passed during the count: the leg is short, the search is not failed. */
    if (!budget?.isTimeout(error)) throw error
    return { kind: 'unbounded', broad: true }
  }
}

/**
 * Resolve the permitted set with the candidate predicate both legs apply, so restricting a leg
 * to it never admits a document the leg would otherwise refuse. Tag filters stay chunk-level in
 * each leg; the set is the document-level superset they narrow.
 *
 * It runs ahead of both legs on the vector leg's budget, so exhausting that budget here reports
 * `unbounded` and marks the vector leg timed out rather than failing the keyword leg with it.
 */
export async function resolvePermittedDocuments(params: {
  knowledgeBaseIds: string[]
  access: UserAccessScope
  filters?: WorkspaceSearchFilters
  budget?: SearchBudget
  accessPlan: SearchAccessPlan
  /** Whether a date or source filter narrows the set, which then is enumerated directly. */
  filtered: boolean
}): Promise<PermittedDocuments> {
  const key = reachKey(params.knowledgeBaseIds, params.access, params.accessPlan)
  let probe: ProbeOutcome
  let broad = true
  /**
   * A remembered reach says how much of the bases the caller reads, which a date filter does not
   * change; the filtered set still has to be enumerated, so under one the probe always runs. A plan
   * under a date or source filter enumerates the filtered set directly; reach cannot stand in for it.
   */
  const remembered = params.filtered ? undefined : saturatedReach.get(key)
  if (remembered) {
    probe = { kind: 'saturated' }
    broad = remembered.broad
  } else {
    try {
      probe = await probeVisibleDocuments(
        visibleDocumentsQuery(
          params.knowledgeBaseIds,
          candidateDocumentConditions(
            params.knowledgeBaseIds,
            params.filters,
            knowledgeCandidateAccessConditionForConnectors(params.access, params.accessPlan)
          ),
          params.access,
          params.filtered ? 'direct' : 'reach-first'
        ),
        params.budget,
        'permitted_documents',
        params.filtered ? FILTERED_PROBE_BUDGET_MS : VECTOR_PROBE_BUDGET_MS
      )
    } catch (error) {
      if (!params.budget?.isTimeout(error)) throw error
      probe = { kind: 'timed_out' }
    }
    if (probe.kind === 'saturated') {
      try {
        const reach = await countReach(
          params.knowledgeBaseIds,
          params.access,
          params.budget,
          params.accessPlan,
          true
        )
        /** A count that ran out of time decides this search only; the next one counts again. */
        if (reach?.empty) probe = { kind: 'documents', documents: [] }
        else if (reach !== null) {
          broad = reach.broad
          saturatedReach.set(key, { broad })
        }
      } catch (error) {
        /** The leg's own deadline passed during the count: the leg is short, the search is not failed. */
        if (!params.budget?.isTimeout(error)) throw error
      }
    }
  }
  const permitted: PermittedDocuments =
    probe.kind === 'documents'
      ? { kind: 'bounded', documents: probe.documents }
      : { kind: 'unbounded', broad }
  annotateSearchDiagnostics({
    permittedDocuments: permitted.kind,
    ...(probe.kind === 'documents' ? { permittedDocumentCount: probe.documents.length } : {}),
  })
  return permitted
}

/**
 * What a user-scoped search-index search resolves about the caller once, before any leg ranks:
 * the connectors it may read and the caller's standing in them, the permitted set or reach, and
 * the proof the gated sources still need.
 */
export interface IndexedRetrievalContext {
  access: UserAccessScope
  accessPlan: SearchAccessPlan
  /** Whether a date or source filter narrows the documents; see {@link isSearchFiltered}. */
  filtered: boolean
  /** Absent for a tag-only search and for explicit documents, which are already a bounded scope. */
  permitted?: PermittedDocuments
  liveSourceAccess?: LiveSourceAccess
}
