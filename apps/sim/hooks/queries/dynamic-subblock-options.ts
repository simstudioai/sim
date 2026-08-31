import { useMemo } from 'react'
import { buildSelectorRawContext } from '@/lib/selectors/context'
import type { SelectorScope } from '@/lib/selectors/types'
import { getDependsOnFields } from '@/lib/workflows/subblocks/dependencies'
import { summarizeNames } from '@/lib/workflows/subblocks/display'
import type { SubBlockConfig } from '@/blocks/types'
import { useSelectorOptionDetails } from '@/hooks/queries/selectors'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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
      typeof entry === 'string' && entry.length > 0 && !entry.startsWith('<')
  )
}

/** Resolves labels for selector-backed values through the shared server facade. */
export function useDynamicSubBlockOptionDisplayName({
  workspaceId,
  blockId,
  subBlock,
  value,
}: UseDynamicSubBlockOptionDisplayNameArgs): string | null {
  const optionIds = useMemo(() => getResolvableOptionIds(value), [value])
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const block = useWorkflowStore((state) => (blockId ? state.blocks[blockId] : undefined))
  const liveValues = useSubBlockStore((state) =>
    activeWorkflowId && blockId ? state.workflowValues[activeWorkflowId]?.[blockId] : undefined
  )
  const selectorKey = subBlock?.selectorKey

  const context = useMemo(() => {
    if (!selectorKey || !block?.type) return {}
    const merged: Record<string, { value?: unknown }> = { ...(block.subBlocks ?? {}) }
    for (const [id, liveValue] of Object.entries(liveValues ?? {})) {
      merged[id] = { ...merged[id], value: liveValue }
    }
    return buildSelectorRawContext({
      selectorKey,
      blockType: block.type,
      subBlocks: merged,
      dependsOn: getDependsOnFields(subBlock.dependsOn),
      canonicalModes: block.data?.canonicalModes,
      triggerMode: block.triggerMode,
      staticContext: {
        mimeType: subBlock.mimeType,
        excludeWorkflowId:
          selectorKey === 'sim.workflows' ? (activeWorkflowId ?? undefined) : undefined,
      },
    })
  }, [activeWorkflowId, block, liveValues, selectorKey, subBlock])

  const scope = useMemo<SelectorScope | undefined>(() => {
    if (activeWorkflowId) {
      return {
        kind: 'workflow',
        workflowId: activeWorkflowId,
        ...(workspaceId ? { workspaceId } : {}),
      }
    }
    return workspaceId ? { kind: 'workspace', workspaceId } : undefined
  }, [activeWorkflowId, workspaceId])

  const { data: selectedOptions } = useSelectorOptionDetails(
    selectorKey ?? 'workspace.triggerTypes',
    {
      context,
      scope,
      detailIds: selectorKey && blockId ? optionIds : [],
      enabled: Boolean(selectorKey && blockId && optionIds.length > 0),
      surfaceId: `canvas:${blockId ?? 'none'}:${subBlock?.id ?? 'none'}`,
    }
  )

  return useMemo(() => {
    if (!selectorKey || optionIds.length === 0) return null
    const labelsById = new Map(selectedOptions.map((option) => [option.id, option.label]))
    const labels = optionIds.map((id) => labelsById.get(id))
    if (!labels.every((label): label is string => Boolean(label))) return null
    return summarizeNames(labels)
  }, [optionIds, selectedOptions, selectorKey])
}
