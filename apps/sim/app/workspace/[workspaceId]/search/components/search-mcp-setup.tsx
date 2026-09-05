'use client'

import { useState } from 'react'
import {
  Button,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalHeader,
} from '@sim/emcn'
import { McpIcon } from '@/components/icons'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'

interface SearchMcpSetupProps {
  workspaceId: string
}

export function SearchMcpSetup({ workspaceId }: SearchMcpSetupProps) {
  const [open, setOpen] = useState(false)
  const endpoint = `${getBaseUrl()}/api/mcp/search/${encodeURIComponent(workspaceId)}`
  return (
    <>
      <SettingsResourceRow
        icon={<McpIcon className='size-[14px]' />}
        title='Connect via MCP'
        description='Search and read your documents from an MCP client.'
        trailing={
          <Button variant='default' size='sm' onClick={() => setOpen(true)}>
            Set up
          </Button>
        }
      />
      <ChipModal open={open} onOpenChange={setOpen} srTitle='Connect Search via MCP'>
        <ChipModalHeader onClose={() => setOpen(false)}>Connect Search via MCP</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='copy'
            title='Server URL'
            value={endpoint}
            copyLabel='Copy MCP server URL'
            hint='Add this URL to your MCP client using Streamable HTTP.'
          />
          <ChipModalField
            type='copy'
            title='Authorization header'
            value='Bearer YOUR_SIM_API_KEY'
            copyLabel='Copy authorization header value'
            hint='Replace YOUR_SIM_API_KEY with your personal Sim API key.'
          />
          <ChipModalField
            type='custom'
            title='API key'
            hint='A personal key uses your document access. A workspace key can only read documents shared with the whole workspace.'
          >
            <ChipLink href={`/workspace/${workspaceId}/settings/apikeys`}>Manage API keys</ChipLink>
          </ChipModalField>
        </ChipModalBody>
      </ChipModal>
    </>
  )
}
