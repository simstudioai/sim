'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  buildToolSubBlockId,
  resolveToolParamSync,
} from '@/lib/workflows/tool-input/synthetic-subblocks'
import { parseStoredToolInputValue } from '@/lib/workflows/tool-input/types'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import type { SubBlockConfig as BlockSubBlockConfig } from '@/blocks/types'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'
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
  activeSearchTarget?: ActiveSearchTarget | null
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
  activeSearchTarget,
}: ToolSubBlockRendererProps) {
  const syntheticId = buildToolSubBlockId(subBlockId, toolIndex, effectiveParamId)
  const toolParamValue = toolParams?.[effectiveParamId] ?? ''
  const isObjectType = OBJECT_SUBBLOCK_TYPES.has(subBlock.type)

  const syncedRef = useRef<string | null>(null)
  const onParamChangeRef = useRef(onParamChange)
  onParamChangeRef.current = onParamChange

  const pushParamValueToStore = useCallback(
    (rawValue: string) => {
      syncedRef.current = rawValue
      if (isObjectType && rawValue) {
        try {
          const parsed = JSON.parse(rawValue)
          if (typeof parsed === 'object' && parsed !== null) {
            useSubBlockStore.getState().setValue(blockId, syntheticId, parsed)
            return
          }
        } catch {}
      }
      useSubBlockStore.getState().setValue(blockId, syntheticId, rawValue)
    },
    [blockId, syntheticId, isObjectType]
  )

  const pushParamValueToStoreRef = useRef(pushParamValueToStore)
  pushParamValueToStoreRef.current = pushParamValueToStore

  useEffect(() => {
    const unsub = useSubBlockStore.subscribe((state, prevState) => {
      const wfId = useWorkflowRegistry.getState().activeWorkflowId
      if (!wfId) return
      const newVal = state.workflowValues[wfId]?.[blockId]?.[syntheticId]
      const oldVal = prevState.workflowValues[wfId]?.[blockId]?.[syntheticId]
      if (newVal === oldVal) return

      const result = resolveToolParamSync(newVal, syncedRef.current)
      if (result.action === 'noop') return

      if (result.action === 'reproject') {
        const tools = parseStoredToolInputValue(
          useSubBlockStore.getState().getValue(blockId, subBlockId)
        )
        const sourceValue = tools[toolIndex]?.params?.[effectiveParamId]
        pushParamValueToStoreRef.current(typeof sourceValue === 'string' ? sourceValue : '')
        return
      }

      syncedRef.current = result.value
      onParamChangeRef.current(toolIndex, effectiveParamId, result.value)
    })
    return unsub
  }, [blockId, subBlockId, syntheticId, toolIndex, effectiveParamId])

  useEffect(() => {
    if (toolParamValue === syncedRef.current) return
    pushParamValueToStore(toolParamValue)
  }, [toolParamValue, pushParamValueToStore])

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
      activeSearchTarget={activeSearchTarget}
    />
  )
}
