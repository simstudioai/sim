import { useCallback, useMemo } from 'react'
import { isEqual } from 'es-toolkit'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { buildCanonicalIndex, resolveDependencyValue } from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Read a sub-block value by either its raw subBlockId or its canonicalParamId.
 *
 * `useSubBlockValue` only looks up the raw subBlockId. For fields that use
 * `canonicalParamId` to unify basic/advanced inputs (e.g. `tableSelector` vs
 * `manualTableId` both mapping to `tableId`), this hook resolves to whichever
 * member of the canonical group currently holds the value.
 */
export function useCanonicalSubBlockValue<T = unknown>(
  blockId: string,
  canonicalOrSubBlockId: string
): T | null {
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const blockState = useWorkflowStore((state) => state.blocks[blockId])
  const blockConfig = blockState?.type ? getBlock(blockState.type) : null
  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(blockConfig?.subBlocks || []),
    [blockConfig?.subBlocks]
  )
  const canonicalModeOverrides = blockState?.data?.canonicalModes

  return useStoreWithEqualityFn(
    useSubBlockStore,
    useCallback(
      (state) => {
        if (!activeWorkflowId) return null
        const blockValues = state.workflowValues[activeWorkflowId]?.[blockId] || {}
        const resolved = resolveDependencyValue(
          canonicalOrSubBlockId,
          blockValues,
          canonicalIndex,
          canonicalModeOverrides
        )
        return (resolved ?? null) as T | null
      },
      [activeWorkflowId, blockId, canonicalOrSubBlockId, canonicalIndex, canonicalModeOverrides]
    ),
    (a, b) => isEqual(a, b)
  )
}
