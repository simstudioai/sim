'use client'

import { useMemo } from 'react'
import { ChipCombobox } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { normalizeMcpOperationPolicy, permitsMcpOperation } from '@/lib/mcp/operation-policy'
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

  const { mcpTools, isLoading, error, refreshTools } = useMcpTools(workspaceId)

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)
  const [, setSchemaCache] = useSubBlockValue(blockId, '_toolSchema')

  const [serverFromStore] = useSubBlockValue(blockId, 'server')
  const [connectionFromStore] = useSubBlockValue(blockId, 'connection')
  const [policyFromStore] = useSubBlockValue(blockId, 'operationPolicy')
  const serverValue = previewContextValues
    ? resolvePreviewContextValue(previewContextValues.server)
    : serverFromStore

  const label = subBlock.placeholder || 'Select tool'

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedToolId = effectiveValue || ''

  const availableTools = useMemo(() => {
    if (!serverValue) return []
    const connection = previewContextValues
      ? resolvePreviewContextValue(previewContextValues.connection)
      : connectionFromStore
    const policy = normalizeMcpOperationPolicy(
      previewContextValues
        ? resolvePreviewContextValue(previewContextValues.operationPolicy)
        : policyFromStore
    )
    return mcpTools.filter(
      (tool) =>
        (connection
          ? tool.serverId === connection
          : tool.serverId === serverValue || tool.canonicalServerId === serverValue) &&
        permitsMcpOperation(policy, tool.canonicalServerId ?? tool.serverId, tool.name)
    )
  }, [serverValue, mcpTools, connectionFromStore, policyFromStore, previewContextValues])

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
