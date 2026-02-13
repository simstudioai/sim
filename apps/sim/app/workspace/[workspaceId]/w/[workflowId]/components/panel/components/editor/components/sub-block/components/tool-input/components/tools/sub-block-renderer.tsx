'use client'

import { useEffect, useRef } from 'react'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import type { SubBlockConfig as BlockSubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface ToolSubBlockRendererProps {
  blockId: string
  subBlockId: string
  toolIndex: number
  subBlock: BlockSubBlockConfig
  effectiveParamId: string
  toolParams: Record<string, string> | undefined
  onParamChange: (toolIndex: number, paramId: string, value: string) => void
  disabled: boolean
  canonicalToggle?: {
    mode: 'basic' | 'advanced'
    disabled?: boolean
    onToggle?: () => void
  }
}

/**
 * SubBlock types whose store values are objects/arrays/non-strings.
 * tool.params stores strings (via JSON.stringify), so when syncing
 * back to the store we parse them to restore the native shape.
 */
const OBJECT_SUBBLOCK_TYPES = new Set(['file-upload', 'table', 'grouped-checkbox-list'])

/**
 * Bridges the subblock store with StoredTool.params via a synthetic store key,
 * then delegates all rendering to SubBlock for full parity.
 */
export function ToolSubBlockRenderer({
  blockId,
  subBlockId,
  toolIndex,
  subBlock,
  effectiveParamId,
  toolParams,
  onParamChange,
  disabled,
  canonicalToggle,
}: ToolSubBlockRendererProps) {
  const syntheticId = `${subBlockId}-tool-${toolIndex}-${effectiveParamId}`
  const toolParamValue = toolParams?.[effectiveParamId] ?? ''
  const isObjectType = OBJECT_SUBBLOCK_TYPES.has(subBlock.type)

  const syncedRef = useRef<string | null>(null)
  const onParamChangeRef = useRef(onParamChange)
  onParamChangeRef.current = onParamChange

  useEffect(() => {
    const unsub = useSubBlockStore.subscribe((state, prevState) => {
      const wfId = useWorkflowRegistry.getState().activeWorkflowId
      if (!wfId) return
      const newVal = state.workflowValues[wfId]?.[blockId]?.[syntheticId]
      const oldVal = prevState.workflowValues[wfId]?.[blockId]?.[syntheticId]
      if (newVal === oldVal) return
      const stringified =
        newVal == null ? '' : typeof newVal === 'string' ? newVal : JSON.stringify(newVal)
      if (stringified === syncedRef.current) return
      syncedRef.current = stringified
      onParamChangeRef.current(toolIndex, effectiveParamId, stringified)
    })
    return unsub
  }, [blockId, syntheticId, toolIndex, effectiveParamId])

  useEffect(() => {
    if (toolParamValue === syncedRef.current) return
    syncedRef.current = toolParamValue
    if (isObjectType && toolParamValue) {
      try {
        const parsed = JSON.parse(toolParamValue)
        if (typeof parsed === 'object' && parsed !== null) {
          useSubBlockStore.getState().setValue(blockId, syntheticId, parsed)
          return
        }
      } catch {}
    }
    useSubBlockStore.getState().setValue(blockId, syntheticId, toolParamValue)
  }, [toolParamValue, blockId, syntheticId, isObjectType])

  const visibility = subBlock.paramVisibility ?? 'user-or-llm'
  const isOptionalForUser = visibility !== 'user-only'

  const config = {
    ...subBlock,
    id: syntheticId,
    ...(isOptionalForUser && { required: false }),
  }

  return (
    <SubBlock
      blockId={blockId}
      config={config}
      isPreview={false}
      disabled={disabled}
      canonicalToggle={canonicalToggle}
      dependencyContext={toolParams}
    />
  )
}
