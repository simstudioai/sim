'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { Combobox } from '@/components/emcn/components'
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel-new/components/editor/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useMcpServers } from '@/hooks/queries/mcp'

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
    />
  )
}
