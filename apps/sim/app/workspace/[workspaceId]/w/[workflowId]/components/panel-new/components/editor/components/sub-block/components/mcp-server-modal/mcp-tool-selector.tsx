'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Combobox } from '@/components/emcn/components'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useMcpTools } from '@/hooks/use-mcp-tools'

interface McpToolSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
}

export function McpToolSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: McpToolSelectorProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [inputValue, setInputValue] = useState('')

  const { mcpTools, isLoading, error, refreshTools, getToolsByServer } = useMcpTools(workspaceId)

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [, setSchemaCache] = useSubBlockValue(blockId, '_toolSchema')

  const [serverValue] = useSubBlockValue(blockId, 'server')

  const label = subBlock.placeholder || 'Select tool'

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedToolId = effectiveValue || ''

  const availableTools = useMemo(() => {
    if (!serverValue) return []
    return getToolsByServer(serverValue)
  }, [serverValue, getToolsByServer])

  const selectedTool = availableTools.find((tool) => tool.id === selectedToolId)

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

  useEffect(() => {
    if (selectedTool) {
      setInputValue(selectedTool.name)
    } else {
      setInputValue('')
    }
  }, [selectedTool])

  const isDisabled = disabled || !serverValue

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
    />
  )
}
