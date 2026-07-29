import { useEffect, useMemo } from 'react'
import { createLogger } from '@sim/logger'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { extractEnvVarName, isEnvVarReference, isReference } from '@/executor/constants'
import { usePersonalEnvironment } from '@/hooks/queries/environment'
import { getSelectorDefinition, mergeOption } from '@/hooks/selectors/registry'
import type {
  SelectorKey,
  SelectorOption,
  SelectorPage,
  SelectorQueryArgs,
} from '@/hooks/selectors/types'

interface SelectorHookArgs extends Omit<SelectorQueryArgs, 'key'> {
  search?: string
  detailId?: string
  enabled?: boolean
}

export interface SelectorOptionsResult {
  data: SelectorOption[] | undefined
  isLoading: boolean
  isFetching: boolean
  /**
   * True while paginated selectors are draining remaining pages in the
   * background. Always false for non-paginated selectors.
   */
  isFetchingMore: boolean
  /**
   * True when the paginated selector still has more pages queued. Always false
   * for non-paginated selectors.
   */
  hasMore: boolean
  /**
   * True when the paginated drain stopped at {@link MAX_AUTO_DRAIN_PAGES} with
   * pages still remaining, so the option list is a partial view. Always false
   * for non-paginated selectors.
   */
  truncated: boolean
  error: Error | null
}

const logger = createLogger('SelectorQuery')

const EMPTY_PAGE: SelectorPage = { items: [], nextCursor: undefined }

/**
 * Safety bound on the background auto-drain. Real dropdowns settle in a handful
 * of pages; this only trips for pathological result sets and prevents an
 * unbounded request loop when a provider keeps handing back cursors.
 */
const MAX_AUTO_DRAIN_PAGES = 50

/** Fallback freshness for selectors that do not declare their own `staleTime`. */
export const DEFAULT_SELECTOR_STALE_TIME = 30_000

/**
 * Fallback for a single-option resolution when the definition declares no
 * `staleTime`: keyed by an exact id, so it changes far less often than a list.
 */
export const DEFAULT_SELECTOR_DETAIL_STALE_TIME = 300_000

export function useSelectorOptions(
  key: SelectorKey,
  args: SelectorHookArgs
): SelectorOptionsResult {
  const definition = getSelectorDefinition(key)
  const queryArgs: SelectorQueryArgs = {
    key,
    context: args.context,
    search: args.search,
  }
  const isEnabled = args.enabled ?? (definition.enabled ? definition.enabled(queryArgs) : true)
  const supportsPagination = Boolean(definition.fetchPage)

  const flatQuery = useQuery<SelectorOption[]>({
    queryKey: definition.getQueryKey(queryArgs),
    queryFn: ({ signal }) =>
      definition.fetchList?.({ ...queryArgs, signal }) ?? Promise.resolve([]),
    enabled: !supportsPagination && isEnabled,
    staleTime: definition.staleTime ?? DEFAULT_SELECTOR_STALE_TIME,
  })

  const pagedQuery = useInfiniteQuery<SelectorPage>({
    queryKey: [...definition.getQueryKey(queryArgs), 'paged'],
    queryFn: ({ pageParam, signal }) => {
      if (!definition.fetchPage) return Promise.resolve(EMPTY_PAGE)
      return definition.fetchPage({
        ...queryArgs,
        cursor: pageParam as string | undefined,
        signal,
      })
    },
    getNextPageParam: (last) => last.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: supportsPagination && isEnabled,
    staleTime: definition.staleTime ?? DEFAULT_SELECTOR_STALE_TIME,
  })

  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = pagedQuery
  const pageCount = pagedQuery.data?.pages.length ?? 0
  const reachedDrainCap = pageCount >= MAX_AUTO_DRAIN_PAGES
  useEffect(() => {
    if (!supportsPagination) return
    if (isError) return
    if (reachedDrainCap) {
      if (hasNextPage) {
        logger.warn('Selector hit auto-drain cap; option list is truncated', {
          key,
          pages: pageCount,
        })
      }
      return
    }
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [
    supportsPagination,
    hasNextPage,
    isFetchingNextPage,
    isError,
    fetchNextPage,
    reachedDrainCap,
    pageCount,
    key,
  ])

  const pagedOptions = useMemo<SelectorOption[] | undefined>(() => {
    if (!supportsPagination) return undefined
    if (!pagedQuery.data) return undefined
    return pagedQuery.data.pages.flatMap((page) => page.items)
  }, [supportsPagination, pagedQuery.data])

  if (supportsPagination) {
    return {
      data: pagedOptions,
      isLoading: pagedQuery.isLoading,
      isFetching: pagedQuery.isFetching,
      isFetchingMore: pagedQuery.isFetchingNextPage,
      hasMore: (pagedQuery.hasNextPage ?? false) && !reachedDrainCap,
      truncated: reachedDrainCap && (pagedQuery.hasNextPage ?? false),
      error: (pagedQuery.error as Error | null) ?? null,
    }
  }

  return {
    data: flatQuery.data,
    isLoading: flatQuery.isLoading,
    isFetching: flatQuery.isFetching,
    isFetchingMore: false,
    hasMore: false,
    truncated: false,
    error: (flatQuery.error as Error | null) ?? null,
  }
}

export function useSelectorOptionDetail(
  key: SelectorKey,
  args: SelectorHookArgs & { detailId?: string }
) {
  const { data: envVariables = {} } = usePersonalEnvironment()
  const definition = getSelectorDefinition(key)

  const resolvedDetailId = useMemo(() => {
    if (!args.detailId) return undefined
    if (isReference(args.detailId)) return undefined
    if (isEnvVarReference(args.detailId)) {
      const varName = extractEnvVarName(args.detailId)
      return envVariables[varName]?.value || undefined
    }
    return args.detailId
  }, [args.detailId, envVariables])

  const queryArgs: SelectorQueryArgs = {
    key,
    context: args.context,
    detailId: resolvedDetailId,
  }
  const hasRealDetailId = Boolean(resolvedDetailId)
  /**
   * Hard precondition: `queryFn` asserts `fetchById` is defined, so this must hold
   * however the caller configures the query — otherwise the assertion throws for the
   * many selectors that declare no `fetchById`.
   */
  const canResolveDetail = hasRealDetailId && definition.fetchById !== undefined
  /**
   * `definition.enabled` describes when the *list* can be fetched, so it gates on
   * context a list needs (credential, domain, region). Resolving one already-known id
   * can need far less — `cloudwatch.*` echoes the id back without calling AWS at all —
   * so a caller that opts in explicitly is only narrowed by the hard precondition.
   * Callers that pass nothing keep the list predicate as their default.
   */
  const enabled =
    (args.enabled ?? (definition.enabled ? definition.enabled(queryArgs) : true)) &&
    canResolveDetail

  const query = useQuery<SelectorOption | null>({
    queryKey: [...definition.getQueryKey(queryArgs), 'detail', resolvedDetailId ?? 'none'],
    queryFn: ({ signal }) => definition.fetchById!({ ...queryArgs, signal }),
    enabled,
    staleTime: definition.staleTime ?? DEFAULT_SELECTOR_DETAIL_STALE_TIME,
  })

  return query
}

/**
 * Resolves several ids at once, so a multi-select field can label every selected
 * value — including values restored from saved config, which no in-session search
 * would have resolved. Query keys match {@link useSelectorOptionDetail} exactly, so
 * the two share a cache and an id already resolved by search costs no extra request.
 */
export function useSelectorOptionDetails(
  key: SelectorKey,
  args: Omit<SelectorHookArgs, 'detailId'> & { detailIds: string[] }
): SelectorOption[] {
  const { data: envVariables = {} } = usePersonalEnvironment()
  const definition = getSelectorDefinition(key)

  const resolvedIds = useMemo(() => {
    const out: string[] = []
    for (const id of args.detailIds) {
      if (!id || isReference(id)) continue
      if (isEnvVarReference(id)) {
        const value = envVariables[extractEnvVarName(id)]?.value
        if (value) out.push(value)
        continue
      }
      out.push(id)
    }
    return Array.from(new Set(out))
  }, [args.detailIds, envVariables])

  const results = useQueries({
    queries: resolvedIds.map((detailId) => {
      const queryArgs: SelectorQueryArgs = { key, context: args.context, detailId }
      const canResolveDetail = definition.fetchById !== undefined
      return {
        queryKey: [...definition.getQueryKey(queryArgs), 'detail', detailId],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          definition.fetchById!({ ...queryArgs, signal }),
        enabled:
          args.enabled !== undefined
            ? args.enabled && canResolveDetail
            : canResolveDetail && (definition.enabled ? definition.enabled(queryArgs) : true),
        staleTime: definition.staleTime ?? DEFAULT_SELECTOR_DETAIL_STALE_TIME,
      }
    }),
  })

  return useMemo(() => results.flatMap((result) => (result.data ? [result.data] : [])), [results])
}

export function useSelectorOptionMap(options: SelectorOption[], extra?: SelectorOption | null) {
  return useMemo(() => {
    const merged = mergeOption(options, extra)
    return new Map(merged.map((option) => [option.id, option]))
  }, [options, extra])
}
