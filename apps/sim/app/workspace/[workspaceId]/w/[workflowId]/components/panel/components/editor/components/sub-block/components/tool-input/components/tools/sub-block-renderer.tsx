'use client'

import { useCallback, useEffect, useRef } from 'react'
import { isUserSuppliedToolParam } from '@/lib/workflows/tool-input/param-visibility'
import {
  buildToolSubBlockId,
  resolveToolParamSync,
} from '@/lib/workflows/tool-input/synthetic-subblocks'
import { parseStoredToolInputValue } from '@/lib/workflows/tool-input/types'
import { DependencyBlockTypeProvider } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-dependency-block-type'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import type { SubBlockConfig as BlockSubBlockConfig } from '@/blocks/types'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { decodeToolParamValue, getSubBlockValueShape } from '@/tools/param-shape'

interface ToolSubBlockRendererProps {
  blockId: string
  subBlockId: string
  toolIndex: number
  subBlock: BlockSubBlockConfig
  effectiveParamId: string
  /** The tool's block type (e.g. `gmail`), so its params' selectors resolve dependencies. */
  toolType: string
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
 * Bridges the subblock store with StoredTool.params via a synthetic store key,
 * then delegates all rendering to SubBlock for full parity.
 */
export function ToolSubBlockRenderer({
  blockId,
  subBlockId,
  toolIndex,
  subBlock,
  effectiveParamId,
  toolType,
  toolParams,
  onParamChange,
  disabled,
  canonicalToggle,
}: ToolSubBlockRendererProps) {
  const syntheticId = buildToolSubBlockId(subBlockId, toolIndex, effectiveParamId)
  const toolParamValue = toolParams?.[effectiveParamId] ?? ''
  const valueShape = getSubBlockValueShape(subBlock)

  const syncedRef = useRef<string | null>(null)
  const onParamChangeRef = useRef(onParamChange)
  onParamChangeRef.current = onParamChange

  /**
   * Hydrates the sub-block store from the stringified `tool.params` value, decoding it
   * back to the shape this sub-block writes.
   *
   * `syncedRef` holds the ENCODED form, so the store subscription below compares like
   * with like and treats a hydrate as a no-op rather than an edit. Without the decode a
   * `switch` set to off hydrated the literal `'false'`, and `checked={Boolean(value)}`
   * rendered it back on after every remount.
   */
  const pushParamValueToStore = useCallback(
    (rawValue: string) => {
      syncedRef.current = rawValue
      useSubBlockStore
        .getState()
        .setValue(blockId, syntheticId, decodeToolParamValue(rawValue, valueShape))
    },
    [blockId, syntheticId, valueShape]
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

  // Shared with the fork-sync gate so "is this the user's to fill?" is answered the same way
  // in the editor and when a sync decides whether a blank value blocks. `required` itself
  // stays for the field below to resolve in its own value context.
  const isOptionalForUser = !isUserSuppliedToolParam(subBlock)

  const config = {
    ...subBlock,
    id: syntheticId,
    ...(isOptionalForUser && { required: false }),
  }

  return (
    <DependencyBlockTypeProvider value={toolType}>
      <SubBlock
        blockId={blockId}
        config={config}
        isPreview={false}
        disabled={disabled}
        canonicalToggle={canonicalToggle}
        dependencyContext={toolParams}
      />
    </DependencyBlockTypeProvider>
  )
}
