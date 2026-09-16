'use client'

import { useMemo } from 'react'
import { ChipCombobox } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useMcpBlockConfig } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-mcp-block-config'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
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

  const { mcpTools, isLoading, error, refreshTools } = useMcpTools(workspaceId)

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [, setSchemaCache] = useSubBlockValue(blockId, '_toolSchema')

  const { server: serverValue } = useMcpBlockConfig({ blockId, previewContextValues })

  const label = subBlock.placeholder || 'Select tool'

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedToolId = effectiveValue || ''

  const availableTools = useMemo(
    () => mcpTools.filter((tool) => tool.serverId === serverValue),
    [mcpTools, serverValue]
  )

  const selectedTool = availableTools.find(
    (tool) => tool.id === selectedToolId || tool.name === selectedToolId
  )

  const comboboxOptions = useMemo(
    () =>
      availableTools.map((tool) => ({
        label: tool.name,
        value: tool.name,
      })),
    [availableTools]
  )

  const inputValue =
    selectedTool?.name ?? (typeof effectiveValue === 'string' ? effectiveValue : '')
  const handleComboboxChange = (value: string) => {
    if (isPreview) return
    const matchedTool = availableTools.find((tool) => tool.name === value)
    setStoreValue(matchedTool?.name ?? value)
    setSchemaCache(matchedTool?.inputSchema ?? null)
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
    <ChipCombobox
      options={comboboxOptions}
      value={inputValue}
      selectedValue={selectedToolId}
      onChange={handleComboboxChange}
      onOpenChange={handleOpenChange}
      placeholder={serverValue ? label : 'Select server first'}
      disabled={isDisabled}
      editable={false}
      searchable
      filterOptions={false}
      isLoading={isLoading}
      error={error || null}
      overlayLabel={inputValue || undefined}
      overlayContent={
        workflowSearchHighlight ? (
          <span>{formatDisplayText(inputValue, { workflowSearchHighlight })}</span>
        ) : undefined
      }
    />
  )
}
