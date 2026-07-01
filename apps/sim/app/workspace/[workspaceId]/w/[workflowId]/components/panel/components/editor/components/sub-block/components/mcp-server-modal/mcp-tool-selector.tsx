'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Combobox } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { resolvePreviewContextValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/utils'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import type { SubBlockConfig } from '@/blocks/types'
import { useMcpTools } from '@/hooks/mcp/use-mcp-tools'

interface McpToolSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
  previewContextValues?: Record<string, unknown>
}

export function McpToolSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  previewContextValues,
}: McpToolSelectorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [inputValue, setInputValue] = useState('')

  const { mcpTools, isLoading, error, refreshTools, getToolsByServer } = useMcpTools(workspaceId)

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [, setSchemaCache] = useSubBlockValue(blockId, '_toolSchema')

  const [serverFromStore] = useSubBlockValue(blockId, 'server')
  const serverValue = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.server)
    : serverFromStore

  const label = subBlock.placeholder || 'Select tool'

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedToolId = effectiveValue || ''

  const availableTools = useMemo(() => {
    if (!serverValue) return []
    return getToolsByServer(serverValue)
  }, [serverValue, getToolsByServer])

  const selectedTool = availableTools.find((tool) => tool.id === selectedToolId)

  const prevSelectedToolRef = useRef<typeof selectedTool>(undefined)
  if (prevSelectedToolRef.current !== selectedTool) {
    prevSelectedToolRef.current = selectedTool
    setInputValue(selectedTool ? selectedTool.name : '')
  }

  useEffect(() => {
    if (serverValue && selectedToolId && !selectedTool && availableTools.length === 0) {
      refreshTools()
    }
  }, [serverValue, selectedToolId, selectedTool, availableTools.length, refreshTools])

  useEffect(() => {
    if (
      storeValue &&
      availableTools.length > 0 &&
      !availableTools.find((tool) => tool.id === storeValue)
    ) {
      if (!isPreview && !disabled) {
        setStoreValue('')
      }
    }
  }, [serverValue, availableTools, storeValue, setStoreValue, isPreview, disabled])

  const comboboxOptions = useMemo(
    () =>
      availableTools.map((tool) => ({
        label: tool.name,
        value: tool.id,
      })),
    [availableTools]
  )

  const handleComboboxChange = (value: string) => {
    const matchedTool = availableTools.find((t) => t.id === value)
    if (matchedTool) {
      setInputValue(matchedTool.name)
      if (!isPreview) {
        setStoreValue(value)
        if (matchedTool.inputSchema) {
          setSchemaCache(matchedTool.inputSchema)
        }
      }
    } else {
      setInputValue(value)
    }
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen && serverValue) {
      refreshTools()
    }
  }

  const isDisabled = disabled || !serverValue
  const workflowSearchHighlight = getWorkflowSearchLabelHighlight({
    activeSearchTarget,
    subBlockId: subBlock.id,
    valuePath: [],
    label: inputValue,
  })

  return (
    <Combobox
      options={comboboxOptions}
      value={inputValue}
      selectedValue={selectedToolId}
      onChange={handleComboboxChange}
      onOpenChange={handleOpenChange}
      placeholder={serverValue ? label : 'Select server first'}
      disabled={isDisabled}
      editable={true}
      filterOptions={true}
      isLoading={isLoading}
      error={error || null}
      overlayContent={
        workflowSearchHighlight ? (
          <span className='block truncate'>
            {formatDisplayText(inputValue, { workflowSearchHighlight })}
          </span>
        ) : undefined
      }
    />
  )
}
