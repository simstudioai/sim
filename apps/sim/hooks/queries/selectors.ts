'use client'

import { useEffect, useId, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { executeSelectorRequest } from '@/lib/selectors/client/execute-selector'
import { projectSelectorContext } from '@/lib/selectors/context'
import {
  getSelectorManifestEntry,
  isSelectorReady,
  type SelectorKey,
} from '@/lib/selectors/manifest'
import type {
  SelectorContext,
  SelectorOption,
  SelectorPage,
  SelectorScope,
} from '@/lib/selectors/types'
import { selectorKeys } from '@/hooks/queries/utils/selector-keys'

const logger = createLogger('SelectorQuery')
const MAX_AUTO_DRAIN_PAGES = 50
const EMPTY_PAGE: SelectorPage = { items: [] }
let nextOpaqueRevision = 1

export type SelectorClientContext = SelectorContext & {
  workflowId?: string
  workspaceId?: string
}

interface SelectorHookArgs {
  context: SelectorClientContext
  scope?: SelectorScope
  search?: string
  enabled?: boolean
  surfaceId?: string
}

export interface SelectorOptionsResult {
  data: SelectorOption[] | undefined
  isLoading: boolean
  isFetching: boolean
  isFetchingMore: boolean
  hasMore: boolean
  truncated: boolean
  error: Error | null
  isSuccess: boolean
  refetch(): void
}

export function selectorScopeFromContext(
  context: SelectorClientContext,
  explicit?: SelectorScope
): SelectorScope | undefined {
  if (explicit) return explicit
  if (context.workflowId) {
    return {
      kind: 'workflow',
      workflowId: context.workflowId,
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
    }
  }
  if (context.workspaceId) return { kind: 'workspace', workspaceId: context.workspaceId }
  return undefined
}

function sameValues(left: readonly unknown[], right: readonly unknown[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  )
}

/**
 * Tracks dependency changes without serializing, hashing, or placing their values in a cache key.
 * The values stay only in the mounted component's ordinary state/ref memory.
 */
function useOpaqueRevision(values: readonly unknown[]): number {
  const state = useRef<{ values: readonly unknown[]; revision: number } | null>(null)
  if (!state.current) {
    state.current = { values, revision: nextOpaqueRevision++ }
  }
  if (!sameValues(state.current.values, values)) {
    state.current = { values, revision: nextOpaqueRevision++ }
  }
  return state.current.revision
}

function usePreparedSelector(
  key: SelectorKey,
  args: SelectorHookArgs,
  requestValues: readonly unknown[]
) {
  const generatedSurfaceId = useId()
  const manifest = getSelectorManifestEntry(key)
  const context = projectSelectorContext(key, args.context)
  const scope = selectorScopeFromContext(args.context, args.scope)
  const contextValues = manifest.context.allowed.map((field) => context[field])
  const revision = useOpaqueRevision([...contextValues, ...requestValues])
  const ready =
    args.enabled !== false &&
    isSelectorReady(key, context) &&
    (manifest.classification === 'local' || Boolean(scope))
  return {
    manifest,
    context,
    scope,
    revision,
    ready,
    surfaceId: args.surfaceId ?? generatedSurfaceId,
  }
}

export function useSelectorOptions(
  key: SelectorKey,
  args: SelectorHookArgs
): SelectorOptionsResult {
  const effectiveSearch = getSelectorManifestEntry(key).supportsSearch ? args.search : undefined
  const prepared = usePreparedSelector(key, args, [effectiveSearch])
  const supportsPagination = prepared.manifest.listMode === 'paginated'
  const baseKey = selectorKeys.request(
    key,
    prepared.scope,
    prepared.surfaceId,
    'list',
    prepared.revision
  )

  const flatQuery = useQuery<SelectorOption[]>({
    // rq-lint-allow: context and search are represented by an opaque privacy revision.
    queryKey: baseKey,
    queryFn: async ({ signal }) => {
      const result = await executeSelectorRequest({
        selectorKey: key,
        scope: prepared.scope,
        context: prepared.context,
        request: {
          kind: 'list',
          ...(effectiveSearch !== undefined ? { search: effectiveSearch } : {}),
        },
        signal,
      })
      if (result.kind !== 'list') throw new Error('Selector returned an unexpected detail result')
      return result.items
    },
    enabled: !supportsPagination && prepared.ready,
    staleTime: prepared.manifest.staleTime,
    gcTime: 0,
  })

  const pagedQuery = useInfiniteQuery<SelectorPage>({
    // rq-lint-allow: context and search are represented by an opaque privacy revision.
    queryKey: [...baseKey, 'paged'],
    queryFn: async ({ pageParam, signal }) => {
      const result = await executeSelectorRequest({
        selectorKey: key,
        scope: prepared.scope,
        context: prepared.context,
        request: {
          kind: 'list',
          ...(effectiveSearch !== undefined ? { search: effectiveSearch } : {}),
          ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
        },
        signal,
      })
      if (result.kind !== 'list') return EMPTY_PAGE
      return result
    },
    getNextPageParam: (last) => last.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: supportsPagination && prepared.ready,
    staleTime: prepared.manifest.staleTime,
    gcTime: 0,
  })

  const pageCount = pagedQuery.data?.pages.length ?? 0
  const reachedDrainCap = pageCount >= MAX_AUTO_DRAIN_PAGES
  useEffect(() => {
    if (!supportsPagination || pagedQuery.isError || !pagedQuery.hasNextPage) return
    if (reachedDrainCap) {
      logger.warn('Selector hit auto-drain cap; option list is truncated', {
        selectorKey: key,
        pages: pageCount,
      })
      return
    }
    if (!pagedQuery.isFetchingNextPage) void pagedQuery.fetchNextPage()
  }, [
    key,
    pageCount,
    pagedQuery.fetchNextPage,
    pagedQuery.hasNextPage,
    pagedQuery.isError,
    pagedQuery.isFetchingNextPage,
    reachedDrainCap,
    supportsPagination,
  ])

  const pagedOptions = useMemo(
    () => pagedQuery.data?.pages.flatMap((page) => page.items),
    [pagedQuery.data]
  )
  if (supportsPagination) {
    return {
      data: pagedOptions,
      isLoading: pagedQuery.isLoading,
      isFetching: pagedQuery.isFetching,
      isFetchingMore: pagedQuery.isFetchingNextPage,
      hasMore: Boolean(pagedQuery.hasNextPage) && !reachedDrainCap,
      truncated: Boolean(pagedQuery.hasNextPage) && reachedDrainCap,
      error: (pagedQuery.error as Error | null) ?? null,
      isSuccess: pagedQuery.isSuccess,
      refetch: () => {
        if (!prepared.ready) return
        void pagedQuery.refetch()
      },
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
    isSuccess: flatQuery.isSuccess,
    refetch: () => {
      if (!prepared.ready) return
      void flatQuery.refetch()
    },
  }
}

export function useSelectorOptionDetail(
  key: SelectorKey,
  args: SelectorHookArgs & { detailId?: string }
) {
  const prepared = usePreparedSelector(key, args, [args.detailId])
  const enabled =
    prepared.ready &&
    prepared.manifest.supportsDetail &&
    args.enabled !== false &&
    Boolean(args.detailId)
  return useQuery<SelectorOption | null>({
    // rq-lint-allow: the detail id and context are represented by an opaque privacy revision.
    queryKey: selectorKeys.request(
      key,
      prepared.scope,
      prepared.surfaceId,
      'detail',
      prepared.revision
    ),
    queryFn: async ({ signal }) => {
      const result = await executeSelectorRequest({
        selectorKey: key,
        scope: prepared.scope,
        context: prepared.context,
        request: { kind: 'detail', id: args.detailId! },
        signal,
      })
      if (result.kind !== 'detail') throw new Error('Selector returned an unexpected list result')
      return result.item
    },
    enabled,
    staleTime: prepared.manifest.staleTime,
    gcTime: 0,
  })
}

export function useSelectorOptionDetails(
  key: SelectorKey,
  args: SelectorHookArgs & { detailIds: string[] }
): SelectorOption[] {
  const uniqueIds = useMemo(() => [...new Set(args.detailIds.filter(Boolean))], [args.detailIds])
  const prepared = usePreparedSelector(key, args, uniqueIds)
  const results = useQueries({
    queries: uniqueIds.map((detailId, ordinal) => ({
      // rq-lint-allow: ids and context are represented by an opaque privacy revision and ordinal.
      queryKey: selectorKeys.request(
        key,
        prepared.scope,
        prepared.surfaceId,
        'detail',
        prepared.revision,
        ordinal
      ),
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const result = await executeSelectorRequest({
          selectorKey: key,
          scope: prepared.scope,
          context: prepared.context,
          request: { kind: 'detail', id: detailId },
          signal,
        })
        if (result.kind !== 'detail') throw new Error('Selector returned an unexpected list result')
        return result.item
      },
      enabled: prepared.ready && prepared.manifest.supportsDetail && args.enabled !== false,
      staleTime: prepared.manifest.staleTime,
      gcTime: 0,
    })),
  })
  return useMemo(() => results.flatMap((result) => (result.data ? [result.data] : [])), [results])
}

export function useSelectorOptionMap(options: SelectorOption[], extra?: SelectorOption | null) {
  return useMemo(() => {
    const merged =
      extra && !options.some((option) => option.id === extra.id) ? [extra, ...options] : options
    return new Map(merged.map((option) => [option.id, option]))
  }, [extra, options])
}
