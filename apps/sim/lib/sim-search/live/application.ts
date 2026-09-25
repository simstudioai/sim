import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { compareStrings } from '@sim/utils/string'
import { z } from 'zod'
import type { WorkspaceSearchFilters } from '@/lib/api/contracts/knowledge'
import type {
  WorkspaceKnowledgeSearchData,
  WorkspaceKnowledgeSearchResult,
} from '@/lib/api/contracts/mothership-assistant-tools'
import {
  type LiveSearchAccountStatus,
  liveSearchProviderSchema,
  type NativeSearchQuery,
  nativeSearchQueriesSchema,
  workspaceSearchFiltersSchema,
} from '@/lib/api/contracts/mothership-assistant-tools'
import { isLiveEnterpriseSearchEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ResourceOwner,
  resourceScopeFromOwner,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import { createPinnedConnectionPool } from '@/lib/core/security/input-validation.server'
import { mapWithConcurrency } from '@/lib/core/utils/concurrency'
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { isKnowledgeSourceUrl } from '@/lib/knowledge/search/citation'
import { measureSearchStage } from '@/lib/knowledge/search/diagnostics'
import { RRF_K } from '@/lib/knowledge/search/recency'
import { matchPassage } from '@/lib/knowledge/search/snippet'
import {
  type LiveAccountSession,
  openLiveAccountSession,
} from '@/lib/sim-search/live/account-session'
import {
  listLiveAccounts,
  resolveListedLiveAccount,
  resolveLiveAccount,
} from '@/lib/sim-search/live/accounts'
import {
  dateSortDirection,
  hasDateBounds,
  matchesSourceDates,
  sourceDate,
  sourceDateType,
  withImpliedListingBound,
} from '@/lib/sim-search/live/dates'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import { joinMessages } from '@/lib/sim-search/live/pages'
import { loadLiveSearchPolicies } from '@/lib/sim-search/live/policy-store'
import { LIVE_SEARCH_PROVIDER_IDS } from '@/lib/sim-search/live/provider-catalog'
import { liveSearchGuidance } from '@/lib/sim-search/live/providers'
import type { LiveAccount, NativeDocument } from '@/lib/sim-search/live/types'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const referenceSchema = z
  .object({
    v: z.literal(1),
    user: z.string().min(1),
    scope: z.string().min(1),
    account: z.string().min(1),
    provider: liveSearchProviderSchema,
    id: z.string().min(1).max(1000),
    container: z.string().max(500).optional(),
    kind: z.string().max(200).optional(),
    revision: z.string().max(200).optional(),
    threadId: z
      .string()
      .regex(/^\d+\.\d+$/)
      .optional(),
  })
  .strict()
type Reference = z.output<typeof referenceSchema>

export function encodeLiveReference(reference: Reference): string {
  const result = `live:${Buffer.from(JSON.stringify(referenceSchema.parse(reference))).toString('base64url')}`
  if (result.length > 4000) throw new Error('Provider document reference is too long')
  return result
}
export function decodeLiveReference(value: string): Reference {
  if (!value.startsWith('live:') || value.length > 4000)
    throw new OrchestrationError('not_found', 'Search again to select a live document')
  try {
    return referenceSchema.parse(
      JSON.parse(Buffer.from(value.slice(5), 'base64url').toString('utf8'))
    )
  } catch {
    throw new OrchestrationError('not_found', 'Invalid live document reference')
  }
}

interface LiveSearchOptions {
  query: string
  topK: number
  filters?: WorkspaceSearchFilters
  nativeQueries?: NativeSearchQuery[]
  signal?: AbortSignal
  resultSecretRegistry?: ResolvedSecretTraceRegistry
}
export type LiveSearchInput = ResourceOwner & LiveSearchOptions

function requireLiveSearch() {
  if (!isLiveEnterpriseSearchEnabled)
    throw new OrchestrationError('not_found', 'Live search is not enabled')
}
function safeContent(content: string, registry?: ResolvedSecretTraceRegistry): string {
  if (!registry) return content
  const projected = projectResolvedSecretModelContent(content, registry)
  if (!projected.safe || typeof projected.value !== 'string')
    throw new Error('Search content projection is unavailable')
  return projected.value
}
export function matchesLiveFilters(
  document: NativeDocument,
  documentId: string,
  provider: string,
  filters?: WorkspaceSearchFilters
): boolean {
  if (!matchesSourceDates(document, provider, filters)) return false
  if (filters?.source && filters.source !== provider) return false
  if (filters?.documentIds && !filters.documentIds.includes(documentId)) return false
  if (filters?.modifiedAfter || filters?.modifiedBefore) {
    const modified = Date.parse(document.modifiedAt ?? '')
    if (!Number.isFinite(modified)) return false
    if (
      filters.modifiedAfter &&
      (!Number.isFinite(Date.parse(filters.modifiedAfter)) ||
        modified < Date.parse(filters.modifiedAfter))
    )
      return false
    if (
      filters.modifiedBefore &&
      (!Number.isFinite(Date.parse(filters.modifiedBefore)) ||
        modified > Date.parse(filters.modifiedBefore))
    )
      return false
  }
  return true
}
/** A provider result with the reference that binds it to this member, scope, and account. */
interface LiveCandidate {
  document: NativeDocument
  documentId: string
}

function candidateFor(
  document: NativeDocument,
  account: LiveAccount,
  owner: ResourceOwner,
  userId: string
): LiveCandidate {
  return {
    document,
    documentId: encodeLiveReference({
      v: 1,
      user: userId,
      scope: resourceScopeKey(resourceScopeFromOwner(owner)),
      account: account.id,
      provider: account.provider,
      id: document.id,
      ...(document.container ? { container: document.container } : {}),
      ...(document.kind ? { kind: document.kind } : {}),
      ...(document.revision ? { revision: document.revision } : {}),
      ...(document.threadId ? { threadId: document.threadId } : {}),
    }),
  }
}

function resultFor(
  { document, documentId }: LiveCandidate,
  account: LiveAccount,
  rank: number,
  previewQuery: string,
  registry?: ResolvedSecretTraceRegistry
): WorkspaceKnowledgeSearchResult {
  return {
    documentId,
    knowledgeBaseId: '',
    knowledgeBaseName: account.displayName,
    documentName: safeContent(document.title, registry),
    sourceUrl: isKnowledgeSourceUrl(document.url) ? document.url : null,
    ...(document.containerName
      ? { sourceContainerName: safeContent(document.containerName, registry) }
      : {}),
    ...(document.containerUrl && isKnowledgeSourceUrl(document.containerUrl)
      ? { sourceContainerUrl: document.containerUrl }
      : {}),
    connectorType: account.provider,
    sourceModifiedAt:
      document.modifiedAt && Number.isFinite(Date.parse(document.modifiedAt))
        ? new Date(document.modifiedAt).toISOString()
        : null,
    sourceDate: sourceDate(document, account.provider) ?? null,
    sourceDateType: sourceDateType(account.provider, document),
    author: document.author ? safeContent(document.author, registry) : null,
    content: matchPassage(safeContent(document.content, registry), previewQuery, PREVIEW_CHARACTERS)
      .content,
    chunkIndex: 0,
    similarity: 1 / (RRF_K + rank),
  }
}

/** Accounts searched at once; bounds token refresh and provider fan-out in large organizations. */
const ACCOUNT_CONCURRENCY = 4
/** Candidates verified at once; each verification is one or more provider requests. */
const VERIFY_CONCURRENCY = 5
const MAX_ACCOUNTS = 20
/** Previews center on the query's longest matching term, like indexed passages. */
const PREVIEW_CHARACTERS = 1800
/** Characters one read returns, the same page budget indexed document reads use. */
const READ_WINDOW_CHARACTERS = 8000

/**
 * Verifies candidates in rank order. A revoked grant fails the whole account; any other
 * verification failure only omits that candidate, and is reported as incomplete coverage.
 */
async function verifyCandidates(session: LiveAccountSession, candidates: LiveCandidate[]) {
  const outcomes = await mapWithConcurrency(
    candidates,
    VERIFY_CONCURRENCY,
    async ({ document }) => {
      try {
        return (await session.verify(document)) ? ('permitted' as const) : ('denied' as const)
      } catch (error) {
        if (error instanceof NativeSearchError && error.status === 'reconnect') throw error
        return error instanceof NativeSearchError && error.status === 'rate_limited'
          ? ('rate_limited' as const)
          : ('unverified' as const)
      }
    }
  )
  return {
    permitted: candidates.filter((_, index) => outcomes[index] === 'permitted'),
    unverified: outcomes.some((outcome) => outcome === 'unverified' || outcome === 'rate_limited'),
    rateLimited: outcomes.includes('rate_limited'),
  }
}

/** Keeps the first of candidates a provider marked as the same item, such as a shared meeting. */
function firstOfEachDocument(candidates: LiveCandidate[]): LiveCandidate[] {
  const seen = new Set<string>()
  return candidates.filter(({ document }) => {
    if (!document.dedupeKey) return true
    if (seen.has(document.dedupeKey)) return false
    seen.add(document.dedupeKey)
    return true
  })
}

/** Whether a result lacks the date metadata the requested date filters need. */
function lacksFilterDate(
  document: NativeDocument,
  provider: string,
  filters?: WorkspaceSearchFilters
): boolean {
  return (
    (Boolean(filters?.startDate || filters?.endDate) && !sourceDate(document, provider)) ||
    (Boolean(filters?.modifiedAfter || filters?.modifiedBefore) &&
      !Number.isFinite(Date.parse(document.modifiedAt ?? '')))
  )
}

/** One native query paired with its index in the request, or neither for a plain-query search. */
interface NativeTarget {
  native?: NativeSearchQuery
  queryIndex?: number
}

function targetsAccount(query: NativeSearchQuery, account: LiveAccount): boolean {
  return query.provider === account.provider && (!query.accountId || query.accountId === account.id)
}

/** Stable account order so equal-rank results from different accounts always merge the same way. */
function compareAccounts(left: LiveAccount, right: LiveAccount): number {
  return (
    LIVE_SEARCH_PROVIDER_IDS.indexOf(left.provider) -
      LIVE_SEARCH_PROVIDER_IDS.indexOf(right.provider) ||
    compareStrings(left.displayName, right.displayName) ||
    compareStrings(left.id, right.id)
  )
}

export const searchLiveKnowledge = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: LiveSearchInput }) => resolveKnowledgeOwnerContext(input),
  async execute({ principal, input }): Promise<WorkspaceKnowledgeSearchData> {
    requireLiveSearch()
    const userId = requirePrincipalSubjectUserId(principal)
    if (input.organizationId) await requireOrganizationSearchAvailable(input.organizationId)
    input.signal?.throwIfAborted()
    const queries = input.nativeQueries
      ? nativeSearchQueriesSchema.parse(input.nativeQueries)
      : undefined
    if (
      (!input.query.trim() && !queries?.some((query) => query.query)) ||
      queries?.some((query) => !query.query)
    )
      input = { ...input, filters: withImpliedListingBound(input.filters, new Date()) }
    if (
      (!input.query.trim() &&
        !hasDateBounds(input.filters) &&
        !queries?.some((query) => query.query)) ||
      input.query.length > 2000 ||
      !Number.isInteger(input.topK) ||
      input.topK < 1 ||
      input.topK > 50
    )
      throw new OrchestrationError('validation', 'Invalid live search query or result limit')
    if (input.filters)
      input = { ...input, filters: workspaceSearchFiltersSchema.parse(input.filters) }
    const filters = input.filters
    if (
      filters?.startDate &&
      filters.endDate &&
      Date.parse(filters.startDate) >= Date.parse(filters.endDate)
    )
      throw new OrchestrationError('validation', 'endDate must be after startDate')
    if (queries?.some((query) => !query.query) && !hasDateBounds(filters))
      throw new OrchestrationError('validation', 'Empty native queries require a date bound')
    const searchSignal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000)
    /** An account's native queries with their request index; none searches it with the plain query. */
    const nativesFor = (account: LiveAccount): NativeTarget[] =>
      queries
        ? [...queries.entries()]
            .filter(([, query]) => targetsAccount(query, account))
            .map(([queryIndex, native]) => ({ native, queryIndex }))
        : [{}]
    const [policies, allAccounts] = await Promise.all([
      measureSearchStage('live.policies', () => loadLiveSearchPolicies(input)),
      measureSearchStage('live.accounts', () => listLiveAccounts(input, userId)),
    ])
    const eligible = allAccounts
      .filter(
        (account) =>
          (!filters?.source || filters.source === account.provider) &&
          nativesFor(account).length > 0
      )
      .sort(compareAccounts)
    const selected = eligible.slice(0, MAX_ACCOUNTS)
    const direction = dateSortDirection(filters)
    const dateSorted = Boolean(direction)
    const pool = createPinnedConnectionPool()
    type SearchedQuery = {
      status: LiveSearchAccountStatus
      /** Each result with the key that identifies its item across this call's queries. */
      results: { key: string; result: WorkspaceKnowledgeSearchResult }[]
    }
    const searchQuery = async (
      account: LiveAccount,
      resolved: Awaited<ReturnType<typeof resolveListedLiveAccount>>,
      session: Awaited<ReturnType<typeof openLiveAccountSession>>,
      native: NativeSearchQuery | undefined,
      status: Pick<LiveSearchAccountStatus, 'accountId' | 'provider' | 'displayName' | 'queryIndex'>
    ): Promise<SearchedQuery> => {
      const page = await measureSearchStage('live.search', () =>
        session.search({
          filters,
          policy: session.policy,
          query: input.query,
          native,
          limit: input.topK,
          scopes: resolved.account.scopes,
        })
      )
      const candidates = page.documents
        .filter((document) => document.id)
        .map((document) => candidateFor(document, account, input, userId))
      /**
       * Local filters run first so provider verification is spent only on eligible results.
       * Undated results are verified too, so their exclusion is reported only when readable.
       */
      const { permitted, unverified, rateLimited } = await measureSearchStage('live.verify', () =>
        verifyCandidates(
          session,
          candidates.filter(
            ({ document, documentId }) =>
              matchesLiveFilters(document, documentId, account.provider, filters) ||
              lacksFilterDate(document, account.provider, filters)
          )
        )
      )
      const matching = firstOfEachDocument(
        permitted.filter(({ document, documentId }) =>
          matchesLiveFilters(document, documentId, account.provider, filters)
        )
      )
      const undatedExcluded = permitted.some(({ document }) =>
        lacksFilterDate(document, account.provider, filters)
      )
      const undatedUnsorted =
        dateSorted && matching.some(({ document }) => !sourceDate(document, account.provider))
      const moreUnsorted = dateSorted && Boolean(page.nextCursor || page.hasMore)
      /** More matches exist that no cursor can reach, so coverage is short. */
      const moreUnreachable = Boolean(page.hasMore && !page.nextCursor)
      /** A continuable page with nothing readable proves nothing about the pages after it. */
      const emptyContinuable = Boolean(page.nextCursor && !matching.length)
      const degraded =
        unverified ||
        session.servicePartial ||
        page.partial ||
        undatedExcluded ||
        undatedUnsorted ||
        moreUnsorted ||
        moreUnreachable ||
        emptyContinuable
      return {
        status: {
          ...status,
          status: degraded ? 'partial' : 'ok',
          message: joinMessages([
            page.message,
            session.servicePartial
              ? 'Service account verification covered a bounded subset of the configured users. Narrow the source user list for complete coverage; external Drive users can only search files also visible to the source administrator.'
              : undefined,
            unverified
              ? rateLimited
                ? 'The provider rate-limited verification, so some results were omitted. Try again later.'
                : 'Some results could not be verified against the source settings and were omitted.'
              : undefined,
            undatedExcluded
              ? 'Some results lacked date metadata and were excluded; date coverage is incomplete.'
              : undefined,
            dateSorted
              ? 'Date order covers retrieved results; follow continuation before claiming an overall earliest or latest match.'
              : undefined,
            moreUnreachable
              ? 'More matches exist than this search could return. Narrow the query or target one source.'
              : undefined,
            emptyContinuable
              ? 'No readable matches on this page. Continue with nextCursor for more.'
              : undefined,
          ]),
          nextCursor: page.nextCursor,
        },
        results: matching.map((candidate, index) => {
          const result = resultFor(
            candidate,
            account,
            index + 1,
            native?.query || input.query,
            input.resultSecretRegistry
          )
          /** A provider's dedupe key names one item across its collections, within its account. */
          const { dedupeKey } = candidate.document
          return {
            key: dedupeKey
              ? JSON.stringify([account.id, dedupeKey])
              : result.sourceUrl || result.documentId,
            result,
          }
        }),
      }
    }
    /** One session per account serves each of its native queries, each reported on its own. */
    const searchAccount = async (account: LiveAccount): Promise<SearchedQuery[]> => {
      const natives = nativesFor(account)
      const statusFor = ({ queryIndex }: NativeTarget) => ({
        accountId: account.id,
        provider: account.provider,
        displayName: account.displayName,
        ...(queryIndex === undefined ? {} : { queryIndex }),
      })
      /** Cancels requests still in flight once the account settles, including after a failure. */
      const settled = new AbortController()
      const signal = AbortSignal.any([searchSignal, AbortSignal.timeout(12_000), settled.signal])
      const failed = (error: unknown, target: NativeTarget): SearchedQuery => {
        input.signal?.throwIfAborted()
        const failure =
          error instanceof NativeSearchError
            ? error
            : signal.aborted
              ? new NativeSearchError(
                  'timeout',
                  'Provider search timed out. Narrow the query or try again.'
                )
              : new NativeSearchError(
                  'unavailable',
                  'This account could not be searched. Check the connection and try again.'
                )
        return {
          status: {
            ...statusFor(target),
            status: failure.status,
            message: failure.message,
            retryAfterSeconds: failure.retryAfterSeconds,
          },
          results: [],
        }
      }
      try {
        signal.throwIfAborted()
        const resolved = await measureSearchStage('live.resolve', () =>
          resolveListedLiveAccount(input, userId, account)
        )
        const session = await measureSearchStage('live.session', () =>
          openLiveAccountSession({
            owner: input,
            userId,
            resolved,
            policies,
            signal,
            pool,
            searches: natives.length,
          })
        )
        return await Promise.all(
          natives.map((target) =>
            searchQuery(account, resolved, session, target.native, statusFor(target)).catch(
              (error) => failed(error, target)
            )
          )
        )
      } catch (error) {
        return natives.map((target) => failed(error, target))
      } finally {
        settled.abort()
      }
    }
    let searched: SearchedQuery[]
    try {
      searched = (await mapWithConcurrency(selected, ACCOUNT_CONCURRENCY, searchAccount)).flat()
    } finally {
      pool.destroy()
    }
    /**
     * Reciprocal rank fusion: every result scores 1 / (RRF_K + rank) within its own query, so a
     * document that several queries return sums those scores (once per query) and outranks one
     * found once.
     */
    const fused = new Map<string, { queries: number[]; result: WorkspaceKnowledgeSearchResult }>()
    for (const [query, { results }] of searched.entries()) {
      for (const { key, result } of results) {
        const match = fused.get(key)
        if (!match) fused.set(key, { queries: [query], result })
        else if (!match.queries.includes(query)) {
          match.queries.push(query)
          match.result = {
            ...match.result,
            similarity: match.result.similarity + result.similarity,
          }
        }
      }
    }
    const ranked = [...fused.values()].sort(({ result: a }, { result: b }) => {
      if (!dateSorted) return b.similarity - a.similarity
      const left = Date.parse(a.sourceDate ?? '')
      const right = Date.parse(b.sourceDate ?? '')
      if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : b.similarity - a.similarity
      if (!Number.isFinite(right)) return -1
      return (direction === 'asc' ? left - right : right - left) || b.similarity - a.similarity
    })
    /**
     * A query's cursor continues after its own page, so it would skip that query's results cut
     * from this merge, including a fused result it shares with another query. Those queries drop
     * the cursor and point to a targeted search instead.
     */
    const truncated = new Set(ranked.slice(input.topK).flatMap(({ queries }) => queries))
    const accounts: LiveSearchAccountStatus[] = searched.map(({ status }, index) => {
      if (!truncated.has(index)) return status
      const { nextCursor: _, ...rest } = status
      return {
        ...rest,
        message: joinMessages([
          status.message,
          'More matches ranked below the returned results. Search this account alone to see them.',
        ]),
      }
    })
    for (const [queryIndex, query] of (queries ?? []).entries()) {
      if (!selected.some((account) => targetsAccount(query, account)))
        accounts.push({
          accountId: query.accountId ?? '',
          provider: query.provider,
          queryIndex,
          displayName: query.provider,
          status: 'reconnect',
          message: 'No connection with this provider is configured and approved in this scope.',
        })
    }
    return {
      query: input.query,
      results: ranked.slice(0, input.topK).map(({ result }) => result),
      retrieval: {
        status:
          accounts.some((account) => account.status !== 'ok') || eligible.length > selected.length
            ? 'partial'
            : 'complete',
        timedOutLegs: [],
      },
      live: {
        backend: 'live',
        accounts,
        guidance: liveSearchGuidance(
          accounts
            .filter((account) => account.status !== 'reconnect')
            .map(({ provider }) => provider)
        ),
      },
    }
  },
})

export type LiveReadInput = ResourceOwner & {
  documentId: string
  filters?: WorkspaceSearchFilters
  limit: number
  startChunkIndex?: number
  startOffset?: number
  resultSecretRegistry: ResolvedSecretTraceRegistry
  signal?: AbortSignal
}

export const readLiveDocument = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.readDocument,
  resolveContext: ({ input }: { input: LiveReadInput }) => resolveKnowledgeOwnerContext(input),
  async execute({ principal, input }) {
    requireLiveSearch()
    const userId = requirePrincipalSubjectUserId(principal)
    if (input.organizationId) await requireOrganizationSearchAvailable(input.organizationId)
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 8)
      throw new OrchestrationError('validation', 'Invalid document read limit')
    const reference = decodeLiveReference(input.documentId)
    if (
      reference.user !== userId ||
      reference.scope !== resourceScopeKey(resourceScopeFromOwner(input))
    )
      throw new OrchestrationError('not_found', 'Document not found in this search scope')
    if (
      (input.filters?.source && input.filters.source !== reference.provider) ||
      (input.filters?.documentIds && !input.filters.documentIds.includes(input.documentId))
    )
      throw new OrchestrationError('not_found', 'Document is outside the selected search filters')
    const [resolved, policies] = await Promise.all([
      resolveLiveAccount(input, userId, reference.account),
      loadLiveSearchPolicies(input),
    ])
    if (resolved.account.provider !== reference.provider)
      throw new OrchestrationError('not_found', 'Document account changed')
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000)
    const pool = createPinnedConnectionPool()
    let document: NativeDocument
    try {
      const session = await openLiveAccountSession({
        owner: input,
        userId,
        resolved,
        policies,
        signal,
        pool,
      })
      if (!(await session.verify(reference)))
        throw new OrchestrationError(
          'not_found',
          'Document is outside your organization’s search scope'
        )
      document = await measureSearchStage('live.read', () => session.read(reference, input.filters))
      if (!(await session.verifyCurrent(document)))
        throw new OrchestrationError(
          'not_found',
          'Document is outside your organization’s search scope'
        )
    } finally {
      pool.destroy()
    }
    if (!matchesLiveFilters(document, input.documentId, reference.provider, input.filters))
      throw new OrchestrationError('not_found', 'Document is outside the selected search filters')
    const content = safeContent(document.content, input.resultSecretRegistry)
    if (input.startChunkIndex && input.startChunkIndex !== 0)
      throw new OrchestrationError(
        'validation',
        'Live documents use chunk index zero; continue using next.startOffset'
      )
    const start = input.startOffset ?? 0
    if (!Number.isSafeInteger(start) || start < 0 || start > content.length)
      throw new OrchestrationError(
        'validation',
        'This document changed. Read again from the beginning'
      )
    const end = Math.min(content.length, start + READ_WINDOW_CHARACTERS)
    return {
      documentId: input.documentId,
      knowledgeBaseId: '',
      knowledgeBaseName: resolved.account.displayName,
      documentName: safeContent(document.title, input.resultSecretRegistry),
      sourceUrl: isKnowledgeSourceUrl(document.url) ? document.url : null,
      connectorType: reference.provider,
      sourceModifiedAt: document.modifiedAt ?? null,
      sourceDate: sourceDate(document, reference.provider) ?? null,
      ...(document.containerName
        ? { sourceContainerName: safeContent(document.containerName, input.resultSecretRegistry) }
        : {}),
      ...(document.containerUrl && isKnowledgeSourceUrl(document.containerUrl)
        ? { sourceContainerUrl: document.containerUrl }
        : {}),
      chunks: [
        {
          chunkIndex: 0,
          content: content.slice(start, end),
          startOffset: start,
          endOffset: end,
          totalCharacters: content.length,
        },
      ],
      hasMore: end < content.length,
      next: end < content.length ? { startChunkIndex: 0, startOffset: end } : null,
    }
  },
})

/** Metadata only; the provider's token is still reauthorized at search/read time. */
export const listLiveSearchAccounts = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listPersonalSearchIntegrations,
  resolveContext: ({ input }: { input: ResourceOwner }) => resolveKnowledgeOwnerContext(input),
  async execute({ principal, input }) {
    requireLiveSearch()
    if (input.organizationId) await requireOrganizationSearchAvailable(input.organizationId)
    const accounts = await listLiveAccounts(input, requirePrincipalSubjectUserId(principal))
    return {
      backend: 'live' as const,
      accounts: accounts.map(({ id, provider, providerId, displayName, scopes }) => ({
        credentialId: id,
        provider,
        providerId,
        displayName,
        searchPermission:
          provider === 'slack' && !scopes.includes('search:read.public')
            ? 'reconnect_for_rts'
            : 'provider_checked_at_search',
      })),
      guidance: liveSearchGuidance(accounts.map((account) => account.provider)),
    }
  },
})
