import { useCallback, useMemo } from 'react'
import { isEqual } from 'es-toolkit'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import {
  buildCanonicalIndexForSurface,
  type CanonicalIndex,
  type CanonicalModeOverrides,
  resolveActiveDependencyValue,
  resolveDependencyValue,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

type CanonicalResolver = (
  key: string,
  values: Record<string, unknown>,
  canonicalIndex: CanonicalIndex,
  overrides?: CanonicalModeOverrides
) => unknown

/** Subscribes to one key of a block's values, read through the given canonical resolver. */
function useResolvedSubBlockValue<T>(
  blockId: string,
  canonicalOrSubBlockId: string,
  resolve: CanonicalResolver
): T | null {
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const blockState = useWorkflowStore((state) => state.blocks[blockId])
  const blockConfig = blockState?.type ? getBlock(blockState.type) : null
  const triggerSurface = blockState?.triggerMode === true
  const canonicalIndex = useMemo(
    () => buildCanonicalIndexForSurface(blockConfig?.subBlocks || [], triggerSurface),
    [blockConfig?.subBlocks, triggerSurface]
  )
  const canonicalModeOverrides = blockState?.data?.canonicalModes

  return useStoreWithEqualityFn(
    useSubBlockStore,
    useCallback(
      (state) => {
        if (!activeWorkflowId) return null
        const blockValues = state.workflowValues[activeWorkflowId]?.[blockId] || {}
        const resolved = resolve(
          canonicalOrSubBlockId,
          blockValues,
          canonicalIndex,
          canonicalModeOverrides
        )
        return (resolved ?? null) as T | null
      },
      [
        activeWorkflowId,
        blockId,
        canonicalOrSubBlockId,
        canonicalIndex,
        canonicalModeOverrides,
        resolve,
      ]
    ),
    (a, b) => isEqual(a, b)
  )
}

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
  return useResolvedSubBlockValue<T>(blockId, canonicalOrSubBlockId, resolveDependencyValue)
}

/**
 * Like {@link useCanonicalSubBlockValue}, but strict: a pair answers with its
 * ACTIVE member only, honoring the user's basic/advanced toggle, so a dormant
 * half's stale value never leaks.
 *
 * This is the reading for a control that narrows itself by a sibling field,
 * such as the file picker's folder scope. The serializer publishes only the
 * active half, so a picker that fell back to the other one would offer a set
 * the operation then ignores.
 */
export function useActiveCanonicalSubBlockValue<T = unknown>(
  blockId: string,
  canonicalOrSubBlockId: string
): T | null {
  return useResolvedSubBlockValue<T>(blockId, canonicalOrSubBlockId, resolveActiveDependencyValue)
}
