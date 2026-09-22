import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
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
import { requireOrganizationSearchAvailable } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { isKnowledgeSourceUrl } from '@/lib/knowledge/search/citation'
import { listLiveAccounts, resolveLiveAccount } from '@/lib/sim-search/live/accounts'
import { createCodaMcpClient, readCodaMcp, searchCodaMcp } from '@/lib/sim-search/live/coda-mcp'
import {
  hasDateBounds,
  matchesSourceDates,
  sourceDate,
  sourceDateType,
} from '@/lib/sim-search/live/dates'
import { createAdminGitLabSession } from '@/lib/sim-search/live/gitlab-admin'
import { createNativeClient, NativeSearchError } from '@/lib/sim-search/live/http'
import { createPolicyVerifier } from '@/lib/sim-search/live/policy'
import { livePolicyFor, loadLiveSearchPolicies } from '@/lib/sim-search/live/policy-store'
import {
  NATIVE_SEARCH_GUIDANCE,
  PROVIDER_ORIGINS,
  readNativeProvider,
  searchNativeProvider,
} from '@/lib/sim-search/live/providers'
import { searchWithinPolicy } from '@/lib/sim-search/live/scoped-search'
import { createLiveServiceSession } from '@/lib/sim-search/live/service-session'
import type {
  LiveAccount,
  NativeDocument,
  NativePage,
  NativeSearchInput,
} from '@/lib/sim-search/live/types'
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
function resultFor(
  document: NativeDocument,
  account: LiveAccount,
  owner: ResourceOwner,
  userId: string,
  rank: number,
  registry?: ResolvedSecretTraceRegistry
): WorkspaceKnowledgeSearchResult {
  const documentId = encodeLiveReference({
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
  })
  // The shared UI wire shape retains its index fields; live results never use them as identifiers.
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
    content: safeContent(document.content, registry).slice(0, 1800),
    chunkIndex: 0,
    similarity: 1 / (60 + rank),
  }
}

export const searchLiveKnowledge = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.search,
  resolveContext: ({ input }: { input: LiveSearchInput }) => resolveKnowledgeOwnerContext(input),
  async execute({ principal, input }): Promise<WorkspaceKnowledgeSearchData> {
    requireLiveSearch()
    const userId = requirePrincipalSubjectUserId(principal)
    if (input.organizationId) await requireOrganizationSearchAvailable(input.organizationId)
    input.signal?.throwIfAborted()
    if (
      (!input.query.trim() && !hasDateBounds(input.filters)) ||
      input.query.length > 2000 ||
      !Number.isInteger(input.topK) ||
      input.topK < 1 ||
      input.topK > 50
    )
      throw new OrchestrationError('validation', 'Invalid live search query or result limit')
    if (input.filters)
      input = { ...input, filters: workspaceSearchFiltersSchema.parse(input.filters) }
    if (
      input.filters?.startDate &&
      input.filters.endDate &&
      Date.parse(input.filters.startDate) >= Date.parse(input.filters.endDate)
    )
      throw new OrchestrationError('validation', 'endDate must be after startDate')
    const queries = input.nativeQueries
      ? nativeSearchQueriesSchema.parse(input.nativeQueries)
      : undefined
    if (queries?.some((query) => !query.query) && !hasDateBounds(input.filters))
      throw new OrchestrationError('validation', 'Empty native queries require a date bound')
    const searchSignal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(20_000)])
      : AbortSignal.timeout(20_000)
    const policies = await loadLiveSearchPolicies(input)
    const allAccounts = await listLiveAccounts(input, userId)
    const eligible = allAccounts.filter(
      (account) =>
        (!input.filters?.source || input.filters.source === account.provider) &&
        (!queries ||
          queries.some(
            (query) =>
              query.provider === account.provider &&
              (!query.accountId || query.accountId === account.id)
          ))
    )
    const selected = eligible.slice(0, 20)
    const accounts: LiveSearchAccountStatus[] = []
    const results: WorkspaceKnowledgeSearchResult[] = []
    // Four accounts at a time bounds token refresh and API fanout across large organizations.
    for (let offset = 0; offset < selected.length; offset += 4) {
      const batch = await Promise.all(
        selected.slice(offset, offset + 4).map(async (account) => {
          const status = {
            accountId: account.id,
            provider: account.provider,
            displayName: account.displayName,
          }
          const signal = AbortSignal.any([searchSignal, AbortSignal.timeout(12_000)])
          try {
            signal.throwIfAborted()
            const resolved = await resolveLiveAccount(input, userId, account.id)
            const client =
              resolved.account.type === 'managed_mcp'
                ? null
                : createNativeClient({
                    origin:
                      'origin' in resolved ? resolved.origin : PROVIDER_ORIGINS[account.provider],
                    accessToken: resolved.accessToken,
                    signal,
                  })
            const native = queries?.find(
              (query) =>
                query.provider === account.provider &&
                (!query.accountId || query.accountId === account.id)
            )
            let policy = livePolicyFor(policies, account.provider)
            const admin =
              'adminSource' in resolved && client
                ? await createAdminGitLabSession({
                    owner: input,
                    userId,
                    source: resolved.adminSource,
                    token: resolved.accessToken,
                    client,
                    signal,
                  })
                : undefined
            const mcp = client
              ? undefined
              : await createCodaMcpClient(input, userId, account.id, signal)
            const service = await createLiveServiceSession({
              owner: input,
              userId,
              provider: account.provider,
              policy,
              member: client,
              mcp,
              signal,
            })
            if (service) policy = service.policy
            const verify =
              service?.verify ??
              createPolicyVerifier(
                account.provider,
                policy,
                client,
                'origin' in resolved ? resolved.origin : PROVIDER_ORIGINS[account.provider],
                mcp
              )
            const searchInput: NativeSearchInput = {
              filters: input.filters,
              policy,
              query: input.query,
              native,
              limit: input.topK,
              scopes: resolved.account.scopes,
            }
            const scopedInput = service?.scopeSearch
              ? service.scopeSearch(searchInput)
              : searchInput
            const page: NativePage =
              scopedInput === null
                ? { documents: [] }
                : admin
                  ? await admin.search(scopedInput)
                  : await searchWithinPolicy(account.provider, client, scopedInput, (scoped) =>
                      client
                        ? searchNativeProvider(account.provider, client, scoped)
                        : searchCodaMcp(mcp!, scoped)
                    )
            const permitted: NativeDocument[] = []
            let unverified = false
            for (const document of page.documents) {
              try {
                if ((await verify(document)) && (!admin || (await admin.verify(document))))
                  permitted.push(document)
              } catch (error) {
                if (error instanceof NativeSearchError && error.status === 'reconnect') throw error
                unverified = true
              }
            }
            const rows = permitted
              .filter((document) => document.id)
              .map((document, index) => ({
                document,
                result: resultFor(
                  document,
                  account,
                  input,
                  userId,
                  index + 1,
                  input.resultSecretRegistry
                ),
              }))
            const matching = rows
              .filter(({ document, result }) =>
                matchesLiveFilters(document, result.documentId, account.provider, input.filters)
              )
              .map(({ result }) => result)
            return {
              status: {
                ...status,
                status:
                  (input.filters?.sortBy &&
                    input.filters.sortBy !== 'relevance' &&
                    rows.some(
                      ({ document }) =>
                        !Number.isFinite(Date.parse(sourceDate(document, account.provider) ?? ''))
                    )) ||
                  unverified ||
                  service?.partial ||
                  page.partial ||
                  page.nextCursor ||
                  matching.length < rows.length
                    ? ('partial' as const)
                    : ('ok' as const),
                message:
                  [
                    page.message,
                    service?.partial
                      ? 'Service account verification covered a bounded subset of the configured users. Narrow the source user list for complete coverage; external Drive users can only search files also visible to the source administrator.'
                      : undefined,
                    (input.filters?.startDate || input.filters?.endDate) &&
                    rows.some(
                      ({ document }) =>
                        !Number.isFinite(Date.parse(sourceDate(document, account.provider) ?? ''))
                    )
                      ? 'Some results lacked date metadata and were excluded; date coverage is incomplete.'
                      : undefined,
                    input.filters?.sortBy && input.filters.sortBy !== 'relevance'
                      ? 'Date order covers retrieved results; follow continuation before claiming an overall earliest or latest match.'
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined,
                nextCursor: page.nextCursor,
              },
              results: matching,
            }
          } catch (error) {
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
                ...status,
                status: failure.status,
                message: failure.message,
                retryAfterSeconds: failure.retryAfterSeconds,
              },
              results: [],
            }
          }
        })
      )
      for (const item of batch) {
        accounts.push(item.status)
        results.push(...item.results)
      }
    }
    for (const query of queries ?? []) {
      if (
        !selected.some(
          (account) =>
            account.provider === query.provider &&
            (!query.accountId || query.accountId === account.id)
        )
      )
        accounts.push({
          accountId: query.accountId ?? '',
          provider: query.provider,
          displayName: query.provider,
          status: 'reconnect',
          message: 'No connection with this provider is configured and approved in this scope.',
        })
    }
    const seen = new Set<string>()
    const ranked = results
      .sort((a, b) => {
        if (!input.filters?.sortBy || input.filters.sortBy === 'relevance')
          return b.similarity - a.similarity
        const left = Date.parse(a.sourceDate ?? '')
        const right = Date.parse(b.sourceDate ?? '')
        if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : b.similarity - a.similarity
        if (!Number.isFinite(right)) return -1
        return (
          (input.filters.sortBy === 'oldest' ? left - right : right - left) ||
          b.similarity - a.similarity
        )
      })
      .filter((item) => {
        const key = item.sourceUrl || item.documentId
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
    return {
      query: input.query,
      results: ranked.slice(0, input.topK),
      retrieval: {
        status:
          accounts.some((account) => account.status !== 'ok') ||
          eligible.length > selected.length ||
          ranked.length > input.topK
            ? 'partial'
            : 'complete',
        timedOutLegs: [],
      },
      live: { backend: 'live', accounts, guidance: NATIVE_SEARCH_GUIDANCE },
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
    const resolved = await resolveLiveAccount(input, userId, reference.account)
    if (resolved.account.provider !== reference.provider)
      throw new OrchestrationError('not_found', 'Document account changed')
    const signal = input.signal
      ? AbortSignal.any([input.signal, AbortSignal.timeout(15_000)])
      : AbortSignal.timeout(15_000)
    const client =
      resolved.account.type === 'managed_mcp'
        ? null
        : createNativeClient({
            origin: 'origin' in resolved ? resolved.origin : PROVIDER_ORIGINS[reference.provider],
            accessToken: resolved.accessToken,
            signal,
          })
    let policy = livePolicyFor(await loadLiveSearchPolicies(input), reference.provider)
    const admin =
      'adminSource' in resolved && client
        ? await createAdminGitLabSession({
            owner: input,
            userId,
            source: resolved.adminSource,
            token: resolved.accessToken,
            client,
            signal,
          })
        : undefined
    const mcp = client
      ? undefined
      : await createCodaMcpClient(input, userId, reference.account, signal)
    const service = await createLiveServiceSession({
      owner: input,
      userId,
      provider: reference.provider,
      policy,
      member: client,
      mcp,
      signal,
    })
    if (service) policy = service.policy
    const verify =
      service?.verify ??
      createPolicyVerifier(
        reference.provider,
        policy,
        client,
        'origin' in resolved ? resolved.origin : PROVIDER_ORIGINS[reference.provider],
        mcp
      )
    if (!(await verify(reference)) || (admin && !(await admin.verify(reference))))
      throw new OrchestrationError(
        'not_found',
        'Document is outside your organization’s search scope'
      )
    const document = admin
      ? await admin.read(reference)
      : client
        ? await readNativeProvider(reference.provider, client, reference, policy, input.filters)
        : await readCodaMcp(mcp!, reference.id)
    const currentPolicy = livePolicyFor(await loadLiveSearchPolicies(input), reference.provider)
    const currentService = await createLiveServiceSession({
      owner: input,
      userId,
      provider: reference.provider,
      policy: currentPolicy,
      member: client,
      mcp,
      signal,
    })
    const verifyCurrent =
      currentService?.verify ??
      createPolicyVerifier(
        reference.provider,
        currentPolicy,
        client,
        'origin' in resolved ? resolved.origin : PROVIDER_ORIGINS[reference.provider],
        mcp
      )
    if (!(await verifyCurrent(document)))
      throw new OrchestrationError(
        'not_found',
        'Document is outside your organization’s search scope'
      )
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
    const end = Math.min(content.length, start + 8000)
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
      guidance: NATIVE_SEARCH_GUIDANCE,
    }
  },
})
