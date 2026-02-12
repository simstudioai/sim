'use client'

import { useEffect, useMemo, useRef } from 'react'
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
 * Bridges the subblock store with StoredTool.params via a synthetic store key,
 * then delegates all rendering to SubBlock for full parity.
 *
 * Two effects handle bidirectional sync:
 * - tool.params → store (external changes)
 * - store → tool.params (user interaction)
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

  /** Tracks the last value we pushed to the store from tool.params to avoid echo loops */
  const lastPushedToStoreRef = useRef<string | null>(null)
  /** Tracks the last value we synced back to tool.params from the store */
  const lastPushedToParamsRef = useRef<string | null>(null)

  // Sync tool.params → store: push when the prop value changes (including first mount)
  useEffect(() => {
    if (!toolParamValue && lastPushedToStoreRef.current === null) {
      // Skip initializing the store with an empty value on first mount —
      // let the SubBlock component use its own default.
      lastPushedToStoreRef.current = toolParamValue
      lastPushedToParamsRef.current = toolParamValue
      return
    }
    if (toolParamValue !== lastPushedToStoreRef.current) {
      lastPushedToStoreRef.current = toolParamValue
      lastPushedToParamsRef.current = toolParamValue
      setStoreValue(toolParamValue)
    }
  }, [toolParamValue, setStoreValue])

  // Sync store → tool.params: push when the user changes the value via SubBlock
  useEffect(() => {
    if (storeValue == null) return
    const stringValue = typeof storeValue === 'string' ? storeValue : JSON.stringify(storeValue)
    if (stringValue !== lastPushedToParamsRef.current) {
      lastPushedToParamsRef.current = stringValue
      lastPushedToStoreRef.current = stringValue
      onParamChange(toolIndex, effectiveParamId, stringValue)
    }
  }, [storeValue, toolIndex, effectiveParamId, onParamChange])

  // Determine if the parameter is optional for the user (LLM can fill it)
  const visibility = subBlock.paramVisibility ?? 'user-or-llm'
  const isOptionalForUser = visibility !== 'user-only'

  const labelSuffix = useMemo(
    () =>
      isOptionalForUser ? (
        <span className='-ml-[3px] text-[12px] font-normal text-[var(--text-tertiary)]'>
          (optional)
        </span>
      ) : null,
    [isOptionalForUser]
  )

  // Suppress SubBlock's "*" required indicator for optional-for-user params
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
      labelSuffix={labelSuffix}
      dependencyContext={toolParams}
    />
  )
}
