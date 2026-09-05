'use client'

import {
  Chip,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalField,
  ChipModalHeader,
} from '@sim/emcn'
import { useQueryState } from 'nuqs'
import { McpIcon } from '@/components/icons'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { searchSetupDestination } from '@/lib/sim-search/setup-navigation'
import { searchMcpSetupParam } from '@/app/workspace/[workspaceId]/search/search-params'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'

interface SearchMcpSetupProps {
  workspaceId: string
}

export function SearchMcpSetup({ workspaceId }: SearchMcpSetupProps) {
  const [open, setOpen] = useQueryState(
    searchMcpSetupParam.key,
    searchMcpSetupParam.parser.withOptions({ history: 'replace' })
  )
  const endpoint = `${getBaseUrl()}/api/mcp/search/${encodeURIComponent(workspaceId)}`
  return (
    <>
      <SettingsResourceRow
        icon={<McpIcon className='size-[14px]' />}
        title='Use Search in other apps via MCP'
        trailing={<Chip onClick={() => setOpen(true)}>Set up</Chip>}
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
            <ChipLink
              href={searchSetupDestination(`/workspace/${workspaceId}/settings/apikeys`, 'mcp')}
            >
              Manage API keys
            </ChipLink>
          </ChipModalField>
        </ChipModalBody>
      </ChipModal>
    </>
  )
}
