'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Combobox } from '@/components/emcn/components'
import { formatDisplayText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/formatted-text'
import { getWorkflowSearchLabelHighlight } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/components/workflow-search-highlight'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useMcpServers } from '@/hooks/queries/mcp'
import type { ActiveSearchTarget } from '@/stores/panel/editor/store'

interface McpServerSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
  activeSearchTarget?: ActiveSearchTarget | null
}

export function McpServerSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
  activeSearchTarget,
}: McpServerSelectorProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [inputValue, setInputValue] = useState('')

  const { data: servers = [], isLoading, error } = useMcpServers(workspaceId)
  const enabledServers = servers.filter((s) => s.enabled && !s.deletedAt)

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  const label = subBlock.placeholder || 'Select MCP server'

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedServerId = effectiveValue || ''

  const selectedServer = enabledServers.find((server) => server.id === selectedServerId)

  const comboboxOptions = useMemo(
    () =>
      enabledServers.map((server) => ({
        label: server.name,
        value: server.id,
      })),
    [enabledServers]
  )

  const handleComboboxChange = (value: string) => {
    const matchedServer = enabledServers.find((s) => s.id === value)
    if (matchedServer) {
      setInputValue(matchedServer.name)
      if (!isPreview) {
        setStoreValue(value)
      }
    } else {
      setInputValue(value)
    }
  }

  useEffect(() => {
    if (selectedServer) {
      setInputValue(selectedServer.name)
    } else {
      setInputValue('')
    }
  }, [selectedServer])
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
