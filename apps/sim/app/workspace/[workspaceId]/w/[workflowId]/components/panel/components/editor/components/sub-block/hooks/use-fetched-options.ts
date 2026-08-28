'use client'

import { useMemo } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { getSelectorManifestEntry, type SelectorKey } from '@/lib/selectors/manifest'
import { buildSelectorContextFromBlock } from '@/lib/workflows/subblocks/context'
import { getBlock } from '@/blocks/registry'
import {
  type SelectorClientContext,
  useSelectorOptionDetail,
  useSelectorOptionDetails,
  useSelectorOptions,
} from '@/hooks/queries/selectors'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

export interface FetchedOption {
  label: string
  id: string
}

type LocalOption = string | { id: string }

interface UseFetchedOptionsProps {
  blockId: string
  subBlockId: string
  dependsOnFields: string[]
  selectorKey?: SelectorKey
  selectorExcludeSelf?: boolean
  isPreview: boolean
  disabled: boolean
  valueToHydrate: string | null | undefined
  valuesToHydrate?: readonly string[]
  localOptions: readonly LocalOption[]
}

export interface UseFetchedOptionsResult {
  fetchedOptions: FetchedOption[]
  isDynamic: boolean
  isLoadingOptions: boolean
  hasLoadedOptions: boolean
  fetchError: string | null
  hydratedOption: FetchedOption | null
  hydratedOptions: FetchedOption[]
  missingOptionId: string | null
  refetch: () => void
}

function hasLocalOption(options: readonly LocalOption[], id: string): boolean {
  return options.some((option) => (typeof option === 'string' ? option === id : option.id === id))
}

/**
 * Adapts ordinary Dropdown/ComboBox fields to the shared React Query selector facade. The
 * context builder keeps active canonical values and exact environment references intact; no
 * provider or environment resolution happens in the browser.
 */
export function useFetchedOptions({
  blockId,
  subBlockId,
  dependsOnFields,
  selectorKey,
  selectorExcludeSelf,
  isPreview,
  disabled,
  valueToHydrate,
  valuesToHydrate,
  localOptions,
}: UseFetchedOptionsProps): UseFetchedOptionsResult {
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)
  const workspaceId = useWorkflowRegistry((state) => state.hydration.workspaceId)
  const block = useWorkflowStore((state) => state.blocks[blockId])
  const liveValues = useSubBlockStore((state) =>
    activeWorkflowId ? state.workflowValues[activeWorkflowId]?.[blockId] : undefined
  )
  const effectiveKey = selectorKey ?? 'workspace.triggerTypes'
  const manifest = getSelectorManifestEntry(effectiveKey)

  const context = useMemo<SelectorClientContext>(() => {
    if (!selectorKey || !block?.type) return {}
    const merged: Record<string, { value?: unknown }> = { ...(block.subBlocks ?? {}) }
    for (const [id, value] of Object.entries(liveValues ?? {})) {
      merged[id] = { ...merged[id], value }
    }
    const selectorConfig = getBlock(block.type)?.subBlocks.find(
      (candidate) => candidate.id === subBlockId
    )
    const projected = buildSelectorContextFromBlock(block.type, merged, {
      selectorKey,
      dependsOn: dependsOnFields,
      canonicalModes: block.data?.canonicalModes,
      triggerMode: block.triggerMode,
      staticContext: {
        ...(selectorConfig?.mimeType ? { mimeType: selectorConfig.mimeType } : {}),
        ...(selectorExcludeSelf && activeWorkflowId ? { excludeWorkflowId: activeWorkflowId } : {}),
      },
    })
    return {
      ...projected,
      ...(activeWorkflowId ? { workflowId: activeWorkflowId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
    }
  }, [
    activeWorkflowId,
    block,
    dependsOnFields,
    liveValues,
    selectorExcludeSelf,
    selectorKey,
    subBlockId,
    workspaceId,
  ])

  const surfaceId = `${blockId}:${subBlockId}`
  const hydrate = Boolean(
    valueToHydrate &&
      !valueToHydrate.startsWith('<') &&
      !hasLocalOption(localOptions, valueToHydrate)
  )
  const detailIds = useMemo(
    () =>
      (valuesToHydrate ?? []).filter(
        (id) => id && !id.startsWith('<') && !hasLocalOption(localOptions, id)
      ),
    [localOptions, valuesToHydrate]
  )
  const listInteractionEnabled = Boolean(selectorKey) && !isPreview && !disabled
  const listHydrationEnabled = Boolean(
    selectorKey &&
      !listInteractionEnabled &&
      !manifest.supportsDetail &&
      (hydrate || detailIds.length > 0)
  )
  const list = useSelectorOptions(effectiveKey, {
    context,
    enabled: listInteractionEnabled || listHydrationEnabled,
    surfaceId,
  })
  const detail = useSelectorOptionDetail(effectiveKey, {
    context,
    detailId: manifest.supportsDetail ? (valueToHydrate ?? undefined) : undefined,
    enabled: Boolean(selectorKey) && manifest.supportsDetail && hydrate,
    surfaceId,
  })
  const details = useSelectorOptionDetails(effectiveKey, {
    context,
    detailIds,
    enabled: Boolean(selectorKey) && manifest.supportsDetail && detailIds.length > 0,
    surfaceId,
  })

  return {
    fetchedOptions: list.data ?? [],
    isDynamic: Boolean(selectorKey),
    isLoadingOptions: list.isLoading,
    hasLoadedOptions: list.isSuccess,
    fetchError: list.error ? getErrorMessage(list.error, 'Failed to fetch options') : null,
    hydratedOption: detail.data ?? null,
    hydratedOptions: details,
    missingOptionId:
      hydrate && detail.isFetched && !detail.isLoading && detail.data === null
        ? (valueToHydrate ?? null)
        : null,
    refetch: list.refetch,
  }
}
