'use client'

import { useState } from 'react'
import { Chip, ChipModal, ChipModalBody, ChipModalHeader } from '@sim/emcn'
import { McpIcon } from '@/components/icons'
import { SearchMcpConnection } from '@/components/search-mcp-connection'
import { getSearchMcpUrl } from '@/lib/knowledge/mcp/urls'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'

interface SearchMcpSetupProps {
  workspaceId: string
}

export function SearchMcpSetup({ workspaceId }: SearchMcpSetupProps) {
  const [open, setOpen] = useState(false)
  const endpoint = getSearchMcpUrl('workspace', workspaceId)

  return (
    <>
      <SettingsResourceRow
        icon={<McpIcon />}
        title='Use Search in other apps via MCP'
        trailing={<Chip onClick={() => setOpen(true)}>Set up</Chip>}
      />
      {open && (
        <ChipModal open onOpenChange={setOpen} srTitle='Connect Search via MCP'>
          <ChipModalHeader onClose={() => setOpen(false)}>Connect Search via MCP</ChipModalHeader>
          <ChipModalBody>
            <SearchMcpConnection key={workspaceId} endpoint={endpoint} />
          </ChipModalBody>
        </ChipModal>
      )}
    </>
  )
}
