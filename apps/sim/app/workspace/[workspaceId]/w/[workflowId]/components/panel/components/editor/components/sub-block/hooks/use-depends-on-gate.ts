'use client'

import { useCallback, useMemo } from 'react'
import { isEqual } from 'es-toolkit'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import {
  buildCanonicalIndex,
  type CanonicalModeOverrides,
  isNonEmptyValue,
  normalizeDependencyValue,
  parseDependsOn,
  resolveActiveDependencyValue,
  resolveDependencyValue,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { useDependencyBlockType } from './use-dependency-block-type'

/**
 * Centralized dependsOn gating for sub-block components.
 * - Computes dependency values from the active workflow/block
 * - Returns a stable disabled flag to pass to inputs and to guard effects
 * - Supports both AND (all) and OR (any) dependency logic
 */
export function useDependsOnGate(
  blockId: string,
  subBlock: SubBlockConfig,
  opts?: {
    disabled?: boolean
    isPreview?: boolean
    previewContextValues?: Record<string, any>
    canonicalModeOverrides?: CanonicalModeOverrides
    strictCanonicalDependencies?: boolean
  }
) {
  const disabledProp = opts?.disabled ?? false
  const isPreview = opts?.isPreview ?? false
  const previewContextValues = opts?.previewContextValues
  const strictCanonicalDependencies = opts?.strictCanonicalDependencies ?? false

  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const blockState = useWorkflowStore((state) => state.blocks[blockId])

  const dependencyBlockType = useDependencyBlockType()
  const blockConfig = dependencyBlockType
    ? getBlock(dependencyBlockType)
    : blockState?.type
      ? getBlock(blockState.type)
      : null
  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(blockConfig?.subBlocks || []),
    [blockConfig?.subBlocks]
  )
  const canonicalModeOverrides = opts?.canonicalModeOverrides ?? blockState?.data?.canonicalModes

  // Parse dependsOn config to get all/any field lists
  const { allFields, anyFields, allDependsOnFields } = useMemo(
    () => parseDependsOn(subBlock.dependsOn),
    [subBlock.dependsOn]
  )

  // For backward compatibility, expose flat list of all dependency fields
  const dependsOn = allDependsOnFields

  const dependencySelector = useCallback(
    (state: ReturnType<typeof useSubBlockStore.getState>) => {
      if (allDependsOnFields.length === 0) return {} as Record<string, unknown>

      const resolveValue = strictCanonicalDependencies
        ? resolveActiveDependencyValue
        : resolveDependencyValue

      // If previewContextValues are provided (e.g., tool parameters), use those first
      if (previewContextValues) {
        const map: Record<string, unknown> = {}
        for (const key of allDependsOnFields) {
          map[key] = normalizeDependencyValue(
            resolveValue(key, previewContextValues, canonicalIndex, canonicalModeOverrides)
          )
        }
        return map
      }

      if (!activeWorkflowId) {
        const map: Record<string, unknown> = {}
        for (const key of allDependsOnFields) {
          map[key] = null
        }
        return map
      }

      const workflowValues = state.workflowValues[activeWorkflowId] || {}
      const blockValues = (workflowValues as any)[blockId] || {}
      const map: Record<string, unknown> = {}
      for (const key of allDependsOnFields) {
        map[key] = normalizeDependencyValue(
          resolveValue(key, blockValues, canonicalIndex, canonicalModeOverrides)
        )
      }
      return map
    },
    [
      allDependsOnFields,
      previewContextValues,
      activeWorkflowId,
      blockId,
      canonicalIndex,
      canonicalModeOverrides,
      strictCanonicalDependencies,
    ]
  )

  // Get values for all dependency fields (both all and any)
  // Use isEqual to prevent re-renders when dependency values haven't actually changed
  const dependencyValues = useStoreWithEqualityFn(useSubBlockStore, dependencySelector, isEqual)

  const depsSatisfied = useMemo(() => {
    // Check all fields (AND logic) - all must be satisfied
    const allSatisfied =
      allFields.length === 0 || allFields.every((key) => isNonEmptyValue(dependencyValues[key]))

    // Check any fields (OR logic) - at least one must be satisfied
    const anySatisfied =
      anyFields.length === 0 || anyFields.some((key) => isNonEmptyValue(dependencyValues[key]))

    return allSatisfied && anySatisfied
  }, [allFields, anyFields, dependencyValues])

  // Block everything except the credential field itself until dependencies are set
  const blocked =
    !isPreview && allDependsOnFields.length > 0 && !depsSatisfied && subBlock.type !== 'oauth-input'

  const finalDisabled = disabledProp || isPreview || blocked

  return {
    dependsOn,
    depsSatisfied,
    blocked,
    finalDisabled,
    dependencyValues,
    canonicalIndex,
  }
}
