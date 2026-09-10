'use client'

import { ChipCombobox } from '@sim/emcn'
import { useParams } from 'next/navigation'
import { McpIcon } from '@/components/icons'
import { getMcpTargetOptions } from '@/components/mcp/target-options'
import { getManagedMcpConnectorIcon } from '@/lib/credential-groups/managed-mcp-connector-icons'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import { useActiveSearchTarget } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/providers/active-search-target-provider'
import type { SubBlockConfig } from '@/blocks/types'
import { useMcpToolServers } from '@/hooks/queries/mcp'

interface McpServerSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
}

export function McpServerSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: McpServerSelectorProps) {
  const activeSearchTarget = useActiveSearchTarget()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: servers = [], isLoading, error } = useMcpToolServers(workspaceId)
  const [configuredServer] = useSubBlockValue(blockId, 'server')
  const targetOptions = getMcpTargetOptions(
    servers,
    subBlock.id === 'connection' ? 'connection' : 'server',
    configuredServer
  )

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  const label = subBlock.placeholder || 'Select MCP server'

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedServerId = effectiveValue || ''

  const selectedServer = targetOptions.find((option) => option.value === selectedServerId)
  const selectedServerLabel = selectedServer?.label

  const comboboxOptions = targetOptions.map((option) => ({
    ...option,
    icon: option.managedConnectorId
      ? getManagedMcpConnectorIcon(option.managedConnectorId)
      : McpIcon,
  }))

  const inputValue =
    selectedServerLabel ?? (typeof effectiveValue === 'string' ? effectiveValue : '')
  const handleComboboxChange = (value: string) => {
    if (!isPreview) setStoreValue(value)
  }

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
      selectedValue={selectedServerId}
      onChange={handleComboboxChange}
      placeholder={label}
      disabled={disabled}
      editable={true}
      filterOptions={true}
      isLoading={isLoading}
      error={error instanceof Error ? error.message : null}
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
