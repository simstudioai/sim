import { useMemo } from 'react'
import { useQueries } from '@tanstack/react-query'
import { buildSelectorContextFromBlock } from '@/lib/workflows/subblocks/context'
import { summarizeNames } from '@/lib/workflows/subblocks/display'
import type { SubBlockConfig } from '@/blocks/types'
import { environmentDependentSelectorKeys } from '@/hooks/selectors/cache-invalidation'
import {
  createSelectorCacheScopeRegistry,
  scopeServerResolvedSelectorContext,
} from '@/hooks/selectors/context-resolution'
import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorContext } from '@/hooks/selectors/types'
import { getScopedSelectorQueryKey } from '@/hooks/selectors/use-selector-query'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export const DYNAMIC_SUBBLOCK_OPTION_STALE_TIME = 30 * 1000

export const dynamicSubBlockOptionKeys = {
  all: ['dynamic-subblock-options'] as const,
  details: () => environmentDependentSelectorKeys.dynamicDetails,
  /**
   * `selectorScope` is the selector's OWN query key for this context — every context field its
   * result depends on, named by the selector rather than restated here. Without it a label
   * resolved under an empty or previous sibling (no credential group picked yet) stays cached
   * and is reused once the sibling is set, so the card keeps showing a raw id or a stale name.
   */
  detail: (
    workspaceId?: string,
    blockId?: string,
    subBlockId?: string,
    optionId?: string,
    selectorScope: readonly unknown[] = []
  ) =>
    [
      ...dynamicSubBlockOptionKeys.details(),
      workspaceId ?? '',
      blockId ?? '',
      subBlockId ?? '',
      optionId ?? '',
      ...selectorScope,
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
  const selectorCacheScopes = useMemo(() => createSelectorCacheScopeRegistry(), [])
  const optionIds = useMemo(() => getResolvableOptionIds(value), [value])
  // Label resolution follows the option source: a selector's own `fetchById`. There is no
  // per-block resolver any more, so a selector without one simply renders the raw id.
  const definition = subBlock?.selectorKey ? getSelectorDefinition(subBlock.selectorKey) : undefined
  const fetchById = definition?.fetchById

  /**
   * The block's own values, the same context the canvas builds. A `workspaceId`-only context
   * silently fails every selector scoped by a sibling — `workspace.credentialGroupProviders`
   * needs the group before it can name a provider, so the card fell back to raw ids.
   */
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const block = useWorkflowStore((state) => (blockId ? state.blocks[blockId] : undefined))
  const liveValues = useSubBlockStore((state) =>
    activeWorkflowId && blockId ? state.workflowValues[activeWorkflowId]?.[blockId] : undefined
  )

  const resolverContext = useMemo((): SelectorContext => {
    if (!block?.type) return { workspaceId }
    const merged: Record<string, { value?: unknown }> = { ...(block.subBlocks ?? {}) }
    for (const [id, value] of Object.entries(liveValues ?? {})) {
      merged[id] = { ...merged[id], value }
    }
    return buildSelectorContextFromBlock(block.type, merged, {
      workflowId: activeWorkflowId ?? undefined,
      workspaceId,
      canonicalModes: block.data?.canonicalModes,
      triggerMode: block.triggerMode,
    })
  }, [block, liveValues, activeWorkflowId, workspaceId])

  const scopedResolverContext = useMemo(
    () =>
      definition
        ? scopeServerResolvedSelectorContext(definition, resolverContext, selectorCacheScopes)
        : resolverContext,
    [definition, resolverContext, selectorCacheScopes]
  )

  /**
   * The selector's own key for this context. Reusing it means the cache is scoped by exactly
   * what the selector reads — no second list of context fields to keep in step, and it stays
   * correct when a selector's dependencies change.
   */
  const selectorScope = useMemo(
    () =>
      definition
        ? getScopedSelectorQueryKey(definition, {
            key: definition.key,
            context: scopedResolverContext,
          })
        : [],
    [definition, scopedResolverContext]
  )
  const canResolve = Boolean(blockId && fetchById && optionIds.length > 0)

  const queries = useQueries({
    queries: canResolve
      ? optionIds.map((optionId) => ({
          queryKey: dynamicSubBlockOptionKeys.detail(
            workspaceId,
            blockId,
            subBlock?.id,
            optionId,
            selectorScope as readonly unknown[]
          ),
          queryFn: ({ signal }) => {
            if (!blockId || !fetchById || !definition) {
              throw new Error('Dynamic subblock option resolver is required')
            }
            return fetchById({
              key: definition.key,
              context: scopedResolverContext,
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
