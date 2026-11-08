'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
import {
  type CanonicalToggle,
  SubBlock,
} from '@/platform/app/(shell)/workspace/[workspaceId]/workflows/_components/editor/sub-block/sub-block'
import {
  DependencyBlockTypeProvider,
  type SubBlockConfig,
  useSubBlockStore,
  useWorkflowRegistry,
} from '@/platform/lib/data/workflow-editor'
import {
  buildToolSubBlockId,
  decodeToolParamValue,
  getSubBlockValueShape,
  isUserSuppliedToolParam,
  parseStoredToolInputValue,
  resolveToolParamSync,
} from '@/platform/lib/data/workflow-editor/tool-input'

interface ToolParamProps {
  blockId: string
  /** The aggregate tool-input sub-block that stores every tool. */
  subBlockId: string
  toolIndex: number
  subBlock: SubBlockConfig
  /** The tool's block type, such as `gmail`, so the param's selectors resolve their dependencies. */
  toolType: string
  toolParams: Record<string, string> | undefined
  operation?: string
  onParamChange: (toolIndex: number, paramId: string, value: string) => void
  disabled: boolean
  canonicalToggle?: CanonicalToggle
}

/**
 * One parameter of a selected tool, rendered by the shared `SubBlock` so it behaves exactly like a
 * block field. The value lives in the tool's `params`; a synthetic sub-block key mirrors it into
 * the store in the shape the field writes, and edits there flow back into `params`.
 */
export function ToolParam({
  blockId,
  subBlockId,
  toolIndex,
  subBlock,
  toolType,
  toolParams,
  operation,
  onParamChange,
  disabled,
  canonicalToggle,
}: ToolParamProps) {
  const paramId = subBlock.id
  const syntheticId = buildToolSubBlockId(subBlockId, toolIndex, paramId)
  const toolParamValue = toolParams?.[paramId] ?? ''
  const valueShape = getSubBlockValueShape(subBlock)

  const syncedRef = useRef<string | null>(null)
  const onParamChangeRef = useRef(onParamChange)
  onParamChangeRef.current = onParamChange

  /**
   * Hydrates the store from the stringified param, decoded to the shape this field writes.
   * `syncedRef` holds the encoded form, so the subscription below reads a hydrate as no edit.
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
    return useSubBlockStore.subscribe((state, prevState) => {
      const workflowId = useWorkflowRegistry.getState().activeWorkflowId
      if (!workflowId) return
      const nextValue = state.workflowValues[workflowId]?.[blockId]?.[syntheticId]
      const previousValue = prevState.workflowValues[workflowId]?.[blockId]?.[syntheticId]
      if (nextValue === previousValue) return

      const result = resolveToolParamSync(nextValue, syncedRef.current)
      if (result.action === 'noop') return

      if (result.action === 'reproject') {
        const tools = parseStoredToolInputValue(
          useSubBlockStore.getState().getValue(blockId, subBlockId)
        )
        const sourceValue = tools[toolIndex]?.params?.[paramId]
        pushParamValueToStoreRef.current(typeof sourceValue === 'string' ? sourceValue : '')
        return
      }

      syncedRef.current = result.value
      onParamChangeRef.current(toolIndex, paramId, result.value)
    })
  }, [blockId, subBlockId, syntheticId, toolIndex, paramId])

  useEffect(() => {
    if (toolParamValue === syncedRef.current) return
    pushParamValueToStore(toolParamValue)
  }, [toolParamValue, pushParamValueToStore])

  const config = useMemo(
    () => ({
      ...subBlock,
      id: syntheticId,
      ...(!isUserSuppliedToolParam(subBlock) && { required: false }),
    }),
    [subBlock, syntheticId]
  )
  const dependencyContext = useMemo(() => ({ ...toolParams, operation }), [toolParams, operation])

  return (
    <DependencyBlockTypeProvider value={toolType}>
      <SubBlock
        blockId={blockId}
        config={config}
        isPreview={false}
        disabled={disabled}
        canonicalToggle={canonicalToggle}
        dependencyContext={dependencyContext}
      />
    </DependencyBlockTypeProvider>
  )
}
