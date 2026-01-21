'use client'

import { useCallback, useMemo } from 'react'
import { isEqual } from 'lodash'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import {
  buildCanonicalIndex,
  isNonEmptyValue,
  resolveDependencyValue,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

type DependsOnConfig = string[] | { all?: string[]; any?: string[] }

/**
 * Parses dependsOn config and returns normalized all/any arrays
 */
function parseDependsOn(dependsOn: DependsOnConfig | undefined): {
  allFields: string[]
  anyFields: string[]
  allDependsOnFields: string[]
} {
  if (!dependsOn) {
    return { allFields: [], anyFields: [], allDependsOnFields: [] }
  }

  if (Array.isArray(dependsOn)) {
    // Simple array format: all fields required (AND logic)
    return { allFields: dependsOn, anyFields: [], allDependsOnFields: dependsOn }
  }

  // Object format with all/any
  const allFields = dependsOn.all || []
  const anyFields = dependsOn.any || []
  return {
    allFields,
    anyFields,
    allDependsOnFields: [...allFields, ...anyFields],
  }
}

/**
 * Centralized dependsOn gating for sub-block components.
 * - Computes dependency values from the active workflow/block
 * - Returns a stable disabled flag to pass to inputs and to guard effects
 * - Supports both AND (all) and OR (any) dependency logic
 */
export function useDependsOnGate(
  blockId: string,
  subBlock: SubBlockConfig,
  opts?: { disabled?: boolean; isPreview?: boolean; previewContextValues?: Record<string, any> }
) {
  const disabledProp = opts?.disabled ?? false
  const isPreview = opts?.isPreview ?? false
  const previewContextValues = opts?.previewContextValues

  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const blockState = useWorkflowStore((state) => state.blocks[blockId])
  const blockConfig = blockState?.type ? getBlock(blockState.type) : null
  const canonicalIndex = useMemo(
    () => buildCanonicalIndex(blockConfig?.subBlocks || []),
    [blockConfig?.subBlocks]
  )
  const canonicalModeOverrides = blockState?.data?.canonicalModes

  // Parse dependsOn config to get all/any field lists
  const { allFields, anyFields, allDependsOnFields } = useMemo(
    () => parseDependsOn(subBlock.dependsOn),
    [subBlock.dependsOn]
  )

  // For backward compatibility, expose flat list of all dependency fields
  const dependsOn = allDependsOnFields

  const normalizeDependencyValue = (rawValue: unknown): unknown => {
    if (rawValue === null || rawValue === undefined) return null

    if (typeof rawValue === 'object') {
      if (Array.isArray(rawValue)) {
        if (rawValue.length === 0) return null
        return rawValue.map((item) => normalizeDependencyValue(item))
      }

      const record = rawValue as Record<string, any>
      if ('value' in record) {
        return normalizeDependencyValue(record.value)
      }
      if ('id' in record) {
        return record.id
      }

      return record
    }

    return rawValue
  }

  const dependencySelector = useCallback(
    (state: ReturnType<typeof useSubBlockStore.getState>) => {
      if (allDependsOnFields.length === 0) return {} as Record<string, unknown>

      // If previewContextValues are provided (e.g., tool parameters), use those first
      if (previewContextValues) {
        const map: Record<string, unknown> = {}
        for (const key of allDependsOnFields) {
          const resolvedValue = resolveDependencyValue(
            key,
            previewContextValues,
            canonicalIndex,
            canonicalModeOverrides
          )
          map[key] = normalizeDependencyValue(resolvedValue)
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
        const resolvedValue = resolveDependencyValue(
          key,
          blockValues,
          canonicalIndex,
          canonicalModeOverrides
        )
        map[key] = normalizeDependencyValue(resolvedValue)
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
    ]
  )

  // Get values for all dependency fields (both all and any)
  // Use isEqual to prevent re-renders when dependency values haven't actually changed
  const dependencyValuesMap = useStoreWithEqualityFn(useSubBlockStore, dependencySelector, isEqual)

  const depsSatisfied = useMemo(() => {
    // Check all fields (AND logic) - all must be satisfied
    const allSatisfied =
      allFields.length === 0 || allFields.every((key) => isNonEmptyValue(dependencyValuesMap[key]))

    // Check any fields (OR logic) - at least one must be satisfied
    const anySatisfied =
      anyFields.length === 0 || anyFields.some((key) => isNonEmptyValue(dependencyValuesMap[key]))

    return allSatisfied && anySatisfied
  }, [allFields, anyFields, dependencyValuesMap])

  // Block everything except the credential field itself until dependencies are set
  const blocked =
    !isPreview && allDependsOnFields.length > 0 && !depsSatisfied && subBlock.type !== 'oauth-input'

  const finalDisabled = disabledProp || isPreview || blocked

  return {
    dependsOn,
    depsSatisfied,
    blocked,
    finalDisabled,
  }
}
