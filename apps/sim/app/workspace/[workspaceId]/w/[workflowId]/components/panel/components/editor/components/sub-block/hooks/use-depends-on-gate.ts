'use client'

import { useMemo } from 'react'
import type { SubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

/**
 * Centralized dependsOn gating for sub-block components.
 * - Computes dependency values from the active workflow/block
 * - Returns a stable disabled flag to pass to inputs and to guard effects
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

  // Use only explicit dependsOn from block config. No inference.
  const dependsOn: string[] = (subBlock.dependsOn as string[] | undefined) || []

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

  const dependencyValues = useSubBlockStore((state) => {
    if (dependsOn.length === 0) return [] as any[]

    // If previewContextValues are provided (e.g., tool parameters), use those first
    if (previewContextValues) {
      return dependsOn.map((depKey) => normalizeDependencyValue(previewContextValues[depKey]))
    }

    if (!activeWorkflowId) return dependsOn.map(() => null)
    const workflowValues = state.workflowValues[activeWorkflowId] || {}
    const blockValues = (workflowValues as any)[blockId] || {}
    return dependsOn.map((depKey) => normalizeDependencyValue((blockValues as any)[depKey]))
  }) as any[]

  const depsSatisfied = useMemo(() => {
    if (dependsOn.length === 0) return true
    return dependencyValues.every((value) => {
      if (value === null || value === undefined) return false
      if (typeof value === 'string') return value.trim().length > 0
      if (Array.isArray(value)) return value.length > 0
      return value !== ''
    })
  }, [dependencyValues, dependsOn])

  // Block everything except the credential field itself until dependencies are set
  const blocked =
    !isPreview && dependsOn.length > 0 && !depsSatisfied && subBlock.type !== 'oauth-input'

  const finalDisabled = disabledProp || isPreview || blocked

  return {
    dependsOn,
    dependencyValues,
    depsSatisfied,
    blocked,
    finalDisabled,
  }
}
