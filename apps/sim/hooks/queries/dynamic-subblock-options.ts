import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { summarizeNames } from '@/lib/workflows/subblocks/display'
import type { SubBlockConfig } from '@/blocks/types'
import { getSelectorDefinition } from '@/hooks/selectors/registry'

export const DYNAMIC_SUBBLOCK_OPTION_STALE_TIME = 30 * 1000

export const dynamicSubBlockOptionKeys = {
  all: ['dynamic-subblock-options'] as const,
  details: () => [...dynamicSubBlockOptionKeys.all, 'detail'] as const,
  detail: (workspaceId?: string, blockId?: string, subBlockId?: string, optionId?: string) =>
    [
      ...dynamicSubBlockOptionKeys.details(),
      workspaceId ?? '',
      blockId ?? '',
      subBlockId ?? '',
      optionId ?? '',
    ] as const,
}

interface UseDynamicSubBlockOptionDisplayNameArgs {
  workspaceId?: string
  blockId?: string
  subBlock?: SubBlockConfig
  value: unknown
}

function getResolvableOptionIds(value: unknown): string[] {
  const values = typeof value === 'string' ? [value] : Array.isArray(value) ? value : []
  return values.filter(
    (entry): entry is string =>
      typeof entry === 'string' &&
      entry.length > 0 &&
      !entry.startsWith('<') &&
      !entry.includes('{{')
  )
}

/** Resolves labels for dropdown options whose choices are loaded dynamically. */
export function useDynamicSubBlockOptionDisplayName({
  workspaceId,
  blockId,
  subBlock,
  value,
}: UseDynamicSubBlockOptionDisplayNameArgs): string | null {
  const optionIds = useMemo(() => getResolvableOptionIds(value), [value])
  // Label resolution follows the option source: a selector's own `fetchById`. There is no
  // per-block resolver any more, so a selector without one simply renders the raw id.
  const definition = subBlock?.selectorKey ? getSelectorDefinition(subBlock.selectorKey) : undefined
  const fetchById = definition?.fetchById
  const canResolve = Boolean(blockId && fetchById && optionIds.length > 0)

  const queries = useQueries({
    queries: canResolve
      ? optionIds.map((optionId) => ({
          queryKey: dynamicSubBlockOptionKeys.detail(workspaceId, blockId, subBlock?.id, optionId),
          queryFn: ({ signal }) => {
            if (!blockId || !fetchById || !definition) {
              throw new Error('Dynamic subblock option resolver is required')
            }
            return fetchById({
              key: definition.key,
              context: { workspaceId },
              detailId: optionId,
              signal,
            })
          },
          staleTime: DYNAMIC_SUBBLOCK_OPTION_STALE_TIME,
        }))
      : [],
  })

  return useMemo(() => {
    if (!canResolve || queries.length !== optionIds.length) return null
    const labels = queries.map((query) => query.data?.label)
    if (!labels.every((label): label is string => Boolean(label))) return null
    return summarizeNames(labels)
  }, [canResolve, optionIds.length, queries])
}
