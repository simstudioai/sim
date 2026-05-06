import { useEffect, useMemo } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
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
  error: Error | null
}

const EMPTY_PAGE: SelectorPage = { items: [], nextCursor: undefined }

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
    queryFn: ({ signal }) => definition.fetchList({ ...queryArgs, signal }),
    enabled: !supportsPagination && isEnabled,
    staleTime: definition.staleTime ?? 30_000,
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
    staleTime: definition.staleTime ?? 30_000,
  })

  const { hasNextPage, isFetchingNextPage, fetchNextPage, isError } = pagedQuery
  useEffect(() => {
    if (!supportsPagination) return
    if (isError) return
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [supportsPagination, hasNextPage, isFetchingNextPage, isError, fetchNextPage])

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
      hasMore: pagedQuery.hasNextPage ?? false,
      error: (pagedQuery.error as Error | null) ?? null,
    }
  }

  return {
    data: flatQuery.data,
    isLoading: flatQuery.isLoading,
    isFetching: flatQuery.isFetching,
    isFetchingMore: false,
    hasMore: false,
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
  const baseEnabled =
    hasRealDetailId && definition.fetchById !== undefined
      ? definition.enabled
        ? definition.enabled(queryArgs)
        : true
      : false
  const enabled = args.enabled ?? baseEnabled

  const query = useQuery<SelectorOption | null>({
    queryKey: [...definition.getQueryKey(queryArgs), 'detail', resolvedDetailId ?? 'none'],
    queryFn: ({ signal }) => definition.fetchById!({ ...queryArgs, signal }),
    enabled,
    staleTime: definition.staleTime ?? 300_000,
  })

  return query
}

export function useSelectorOptionMap(options: SelectorOption[], extra?: SelectorOption | null) {
  return useMemo(() => {
    const merged = mergeOption(options, extra)
    return new Map(merged.map((option) => [option.id, option]))
  }, [options, extra])
}
