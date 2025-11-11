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

  const dependencyValues = useSubBlockStore((state) => {
    if (dependsOn.length === 0) return [] as any[]
    
    // If previewContextValues are provided (e.g., tool parameters), use those first
    if (previewContextValues) {
      return dependsOn.map((depKey) => previewContextValues[depKey] ?? null)
    }
    
    if (!activeWorkflowId) return dependsOn.map(() => null)
    const workflowValues = state.workflowValues[activeWorkflowId] || {}
    const blockValues = (workflowValues as any)[blockId] || {}
    return dependsOn.map((depKey) => (blockValues as any)[depKey] ?? null)
  }) as any[]

  const depsSatisfied = useMemo(() => {
    if (dependsOn.length === 0) return true
    return dependencyValues.every((v) =>
      typeof v === 'string' ? v.trim().length > 0 : v !== null && v !== undefined && v !== ''
    )
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
