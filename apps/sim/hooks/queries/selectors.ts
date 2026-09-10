'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQueries, useQuery } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { personalSourceSetupContract } from '@/lib/api/contracts/knowledge/personal-source-setup'
import {
  type ExecuteSelectorClientInput,
  executeSelectorRequest,
} from '@/lib/selectors/client/execute-selector'
import { projectSelectorContext } from '@/lib/selectors/context'
import { MAX_SELECTOR_OPTIONS, MAX_SELECTOR_PAGES } from '@/lib/selectors/limits'
import {
  getSelectorManifestEntry,
  isSelectorReady,
  type SelectorKey,
} from '@/lib/selectors/manifest'
import type {
  SelectorContext,
  SelectorExecutionResult,
  SelectorOption,
  SelectorPage,
  SelectorScope,
  SelectorSurface,
} from '@/lib/selectors/types'
import { selectorKeys } from '@/hooks/queries/utils/selector-keys'

type SelectorListResult = Extract<SelectorExecutionResult, { kind: 'list' }>

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
  surface?: SelectorSurface
}

async function executeForSurface(
  input: ExecuteSelectorClientInput,
  surface?: SelectorSurface
): Promise<SelectorExecutionResult> {
  if (!surface) return executeSelectorRequest(input)
  const expectedKey = surface.connectorType === 'jira' ? 'jira.projectKeys' : 'confluence.spaces'
  if (
    input.selectorKey !== expectedKey ||
    input.scope?.kind !== 'organization' ||
    input.scope.organizationId !== surface.organizationId ||
    !input.context.oauthCredential ||
    !input.context.domain
  )
    throw new Error('This selector is not available during personal source setup')
  const result = await requestJson(personalSourceSetupContract, {
    body: {
      action: 'options',
      organizationId: surface.organizationId,
      connectorType: surface.connectorType,
      credentialId: input.context.oauthCredential,
      domain: input.context.domain,
      request: input.request,
    },
    signal: input.signal,
  })
  if (result.data.kind !== 'list' && result.data.kind !== 'detail') {
    throw new Error('Personal source setup returned an unexpected selector result')
  }
  return result.data
}

export interface SelectorOptionsResult {
  data: SelectorOption[] | undefined
  isLoading: boolean
  isFetching: boolean
  isFetchingMore: boolean
  isLoadingAll: boolean
  hasMore: boolean
  truncated: boolean
  error: Error | null
  isSuccess: boolean
  loadMore(): void
  loadAll(): Promise<SelectorLoadAllResult>
  refetch(): void
}

export type SelectorLoadAllResult =
  | { status: 'complete'; options: SelectorOption[] }
  | { status: 'partial' | 'error' | 'cancelled' }

interface CollectedSelectorOptions {
  options: SelectorOption[]
  overflowed: boolean
}

interface SelectorOptionDetailsResult {
  data: SelectorOption[]
  isLoading: boolean
}

function combineSelectorOptionDetails(
  results: readonly {
    data: SelectorOption | null | undefined
    isLoading: boolean
  }[]
): SelectorOptionDetailsResult {
  return {
    data: results.flatMap((result) => (result.data ? [result.data] : [])),
    isLoading: results.some((result) => result.isLoading),
  }
}

function collectSelectorOptions(
  pages: readonly SelectorPage[] | undefined
): CollectedSelectorOptions {
  if (!pages) return { options: [], overflowed: false }
  const seen = new Set<string>()
  const options: SelectorOption[] = []
  for (const page of pages) {
    for (const option of page.items) {
      if (seen.has(option.id)) continue
      seen.add(option.id)
      if (options.length >= MAX_SELECTOR_OPTIONS) {
        return { options, overflowed: true }
      }
      options.push(option)
    }
  }
  return { options, overflowed: false }
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
  const revision = useOpaqueRevision([
    ...contextValues,
    ...requestValues,
    args.surface?.kind,
    args.surface?.organizationId,
    args.surface?.connectorType,
  ])
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
    surface: args.surface,
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

  const flatQuery = useQuery<SelectorListResult>({
    // rq-lint-allow: context and search are represented by an opaque privacy revision.
    queryKey: baseKey,
    queryFn: async ({ signal }) => {
      const result = await executeForSurface(
        {
          selectorKey: key,
          scope: prepared.scope,
          context: prepared.context,
          request: {
            kind: 'list',
            ...(effectiveSearch !== undefined ? { search: effectiveSearch } : {}),
          },
          signal,
        },
        prepared.surface
      )
      if (result.kind !== 'list') throw new Error('Selector returned an unexpected detail result')
      return result
    },
    enabled: !supportsPagination && prepared.ready,
    staleTime: prepared.manifest.staleTime,
    gcTime: 0,
  })

  const pagedQuery = useInfiniteQuery<SelectorListResult>({
    // rq-lint-allow: context and search are represented by an opaque privacy revision.
    queryKey: [...baseKey, 'paged'],
    queryFn: async ({ pageParam, signal }) => {
      const result = await executeForSurface(
        {
          selectorKey: key,
          scope: prepared.scope,
          context: prepared.context,
          request: {
            kind: 'list',
            ...(effectiveSearch !== undefined ? { search: effectiveSearch } : {}),
            ...(typeof pageParam === 'string' ? { cursor: pageParam } : {}),
          },
          signal,
        },
        prepared.surface
      )
      if (result.kind !== 'list') throw new Error('Selector returned an unexpected detail result')
      return result
    },
    getNextPageParam: (last) => last.nextCursor,
    initialPageParam: undefined as string | undefined,
    enabled: supportsPagination && prepared.ready,
    staleTime: prepared.manifest.staleTime,
    gcTime: 0,
  })

  const collectedOptions = useMemo(
    () => collectSelectorOptions(pagedQuery.data?.pages),
    [pagedQuery.data?.pages]
  )
  const pagedOptions = collectedOptions.options
  const pageCount = pagedQuery.data?.pages.length ?? 0
  const reachedPageCap = pageCount >= MAX_SELECTOR_PAGES
  const reachedOptionCap = pagedOptions.length >= MAX_SELECTOR_OPTIONS
  const reachedLoadCap = reachedPageCap || reachedOptionCap
  const canLoadMore =
    supportsPagination && prepared.ready && Boolean(pagedQuery.hasNextPage) && !reachedLoadCap
  const loadGenerationRef = useRef(0)
  const pageFetchInFlightRef = useRef(false)
  const [isLoadingAll, setIsLoadingAll] = useState(false)
  const requestIdentity = JSON.stringify(baseKey)

  useEffect(() => {
    loadGenerationRef.current += 1
    pageFetchInFlightRef.current = false
    setIsLoadingAll(false)
    return () => {
      loadGenerationRef.current += 1
      pageFetchInFlightRef.current = false
    }
  }, [requestIdentity, prepared.ready])

  const loadMore = useCallback(() => {
    if (!canLoadMore || pageFetchInFlightRef.current) return
    const generation = ++loadGenerationRef.current
    pageFetchInFlightRef.current = true
    void (async () => {
      if (pagedQuery.isFetchNextPageError) {
        const refreshed = await pagedQuery.refetch()
        if (loadGenerationRef.current !== generation) return
        const refreshedPages = refreshed.data?.pages
        const refreshedLastPage = refreshedPages?.[refreshedPages.length - 1]
        if (refreshed.isError || !refreshedLastPage?.nextCursor) return
      }
      await pagedQuery.fetchNextPage()
    })().finally(() => {
      if (loadGenerationRef.current === generation) pageFetchInFlightRef.current = false
    })
  }, [canLoadMore, pagedQuery.fetchNextPage, pagedQuery.isFetchNextPageError, pagedQuery.refetch])

  const loadAll = useCallback(async (): Promise<SelectorLoadAllResult> => {
    if (!prepared.ready || pageFetchInFlightRef.current || pagedQuery.isFetching) {
      return { status: 'cancelled' }
    }
    const generation = ++loadGenerationRef.current
    pageFetchInFlightRef.current = true
    setIsLoadingAll(true)

    let hasNextPage = Boolean(pagedQuery.hasNextPage)
    let pages = pagedQuery.data?.pages
    try {
      if (pagedQuery.isError || !pages) {
        const refreshed = await pagedQuery.refetch()
        if (loadGenerationRef.current !== generation) return { status: 'cancelled' }
        if (refreshed.isError) return { status: 'error' }
        pages = refreshed.data?.pages
        const refreshedLastPage = pages?.[pages.length - 1]
        hasNextPage = Boolean(refreshedLastPage?.nextCursor)
      }
      while (hasNextPage) {
        const collected = collectSelectorOptions(pages)
        if (
          (pages?.length ?? 0) >= MAX_SELECTOR_PAGES ||
          collected.options.length >= MAX_SELECTOR_OPTIONS ||
          pages?.some((page) => page.truncated)
        )
          return { status: 'partial' }
        const result = await pagedQuery.fetchNextPage()
        if (loadGenerationRef.current !== generation) return { status: 'cancelled' }
        if (result.isError) return { status: 'error' }
        hasNextPage = Boolean(result.hasNextPage)
        pages = result.data?.pages
      }
      const collected = collectSelectorOptions(pages)
      return collected.overflowed || pages?.some((page) => page.truncated)
        ? { status: 'partial' }
        : { status: 'complete', options: collected.options }
    } catch {
      return { status: loadGenerationRef.current === generation ? 'error' : 'cancelled' }
    } finally {
      if (loadGenerationRef.current === generation) {
        pageFetchInFlightRef.current = false
        setIsLoadingAll(false)
      }
    }
  }, [
    prepared.ready,
    pagedQuery.data?.pages,
    pagedQuery.fetchNextPage,
    pagedQuery.hasNextPage,
    pagedQuery.isError,
    pagedQuery.isFetching,
    pagedQuery.refetch,
  ])

  if (supportsPagination) {
    return {
      data: pagedOptions,
      isLoading: pagedQuery.isLoading,
      isFetching: pagedQuery.isFetching,
      isFetchingMore: pagedQuery.isFetchingNextPage || isLoadingAll,
      isLoadingAll,
      hasMore: canLoadMore,
      truncated:
        pagedQuery.data?.pages.some((page) => page.truncated === true) === true ||
        collectedOptions.overflowed ||
        (Boolean(pagedQuery.hasNextPage) && reachedLoadCap),
      error: (pagedQuery.error as Error | null) ?? null,
      isSuccess: pagedQuery.isSuccess,
      loadMore,
      loadAll,
      refetch: () => {
        if (!prepared.ready) return
        loadGenerationRef.current += 1
        pageFetchInFlightRef.current = false
        setIsLoadingAll(false)
        void pagedQuery.refetch()
      },
    }
  }
  return {
    data: flatQuery.data?.items,
    isLoading: flatQuery.isLoading,
    isFetching: flatQuery.isFetching,
    isFetchingMore: false,
    isLoadingAll: false,
    hasMore: false,
    truncated: flatQuery.data?.truncated === true,
    error: (flatQuery.error as Error | null) ?? null,
    isSuccess: flatQuery.isSuccess,
    loadMore: () => undefined,
    loadAll: async () => {
      if (!prepared.ready || flatQuery.isFetching) return { status: 'cancelled' }
      if (flatQuery.isError || !flatQuery.data) return { status: 'error' }
      const collected = collectSelectorOptions([flatQuery.data])
      return flatQuery.data.truncated || collected.overflowed
        ? { status: 'partial' }
        : { status: 'complete', options: collected.options }
    },
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
      const result = await executeForSurface(
        {
          selectorKey: key,
          scope: prepared.scope,
          context: prepared.context,
          request: { kind: 'detail', id: args.detailId! },
          signal,
        },
        prepared.surface
      )
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
): SelectorOptionDetailsResult {
  const uniqueIds = useMemo(() => [...new Set(args.detailIds.filter(Boolean))], [args.detailIds])
  const prepared = usePreparedSelector(key, args, uniqueIds)
  return useQueries({
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
        const result = await executeForSurface(
          {
            selectorKey: key,
            scope: prepared.scope,
            context: prepared.context,
            request: { kind: 'detail', id: detailId },
            signal,
          },
          prepared.surface
        )
        if (result.kind !== 'detail') throw new Error('Selector returned an unexpected list result')
        return result.item
      },
      enabled: prepared.ready && prepared.manifest.supportsDetail && args.enabled !== false,
      staleTime: prepared.manifest.staleTime,
      gcTime: 0,
    })),
    combine: combineSelectorOptionDetails,
  })
}

export function useSelectorOptionMap(options: SelectorOption[], extra?: SelectorOption | null) {
  return useMemo(() => {
    const merged =
      extra && !options.some((option) => option.id === extra.id) ? [extra, ...options] : options
    return new Map(merged.map((option) => [option.id, option]))
  }, [extra, options])
}
