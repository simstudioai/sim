'use client'

import { useEffect, useRef } from 'react'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { SubBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/sub-block'
import type { SubBlockConfig as BlockSubBlockConfig } from '@/blocks/types'

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
  const [storeValue, setStoreValue] = useSubBlockValue(blockId, syntheticId)

  const toolParamValue = toolParams?.[effectiveParamId] ?? ''
  const isObjectType = OBJECT_SUBBLOCK_TYPES.has(subBlock.type)

  const lastPushedToStoreRef = useRef<string | null>(null)
  const lastPushedToParamsRef = useRef<string | null>(null)

  useEffect(() => {
    if (!toolParamValue && lastPushedToStoreRef.current === null) {
      lastPushedToStoreRef.current = toolParamValue
      lastPushedToParamsRef.current = toolParamValue
      return
    }
    if (toolParamValue !== lastPushedToStoreRef.current) {
      lastPushedToStoreRef.current = toolParamValue
      lastPushedToParamsRef.current = toolParamValue

      if (isObjectType && typeof toolParamValue === 'string' && toolParamValue) {
        try {
          const parsed = JSON.parse(toolParamValue)
          if (typeof parsed === 'object' && parsed !== null) {
            setStoreValue(parsed)
            return
          }
        } catch {
          // Not valid JSON — fall through to set as string
        }
      }
      setStoreValue(toolParamValue)
    }
  }, [toolParamValue, setStoreValue, isObjectType])

  useEffect(() => {
    if (storeValue == null && lastPushedToParamsRef.current === null) return
    const stringValue =
      storeValue == null
        ? ''
        : typeof storeValue === 'string'
          ? storeValue
          : JSON.stringify(storeValue)
    if (stringValue !== lastPushedToParamsRef.current) {
      lastPushedToParamsRef.current = stringValue
      lastPushedToStoreRef.current = stringValue
      onParamChange(toolIndex, effectiveParamId, stringValue)
    }
  }, [storeValue, toolIndex, effectiveParamId, onParamChange])

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
