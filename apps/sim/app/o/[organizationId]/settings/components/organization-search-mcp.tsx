'use client'

import { useState } from 'react'
import { Chip, ChipCopyInput, Label } from '@sim/emcn'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { CreateApiKeyModal } from '@/app/workspace/[workspaceId]/settings/components/api-keys/components'

/** A personal key keeps MCP queries subject to the same membership and document ACLs as Home. */
export function OrganizationSearchMcp() {
  const { organization, viewer } = useOrganizationContext()
  const [createKeyOpen, setCreateKeyOpen] = useState(false)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const endpoint = `${getBaseUrl()}/api/mcp/search/organizations/${encodeURIComponent(organization.id)}`
  return (
    <div className='flex max-w-xl flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Label>Server URL</Label>
        <ChipCopyInput value={endpoint} copyLabel='Copy MCP server URL' />
        <p className='text-[var(--text-muted)] text-caption'>Streamable HTTP</p>
      </div>
      <div className='flex flex-col gap-2'>
        <Label>Authorization header</Label>
        <ChipCopyInput
          value={`Bearer ${apiKey ?? 'YOUR_SIM_API_KEY'}`}
          copyLabel='Copy authorization header'
        />
        <p className='text-[var(--text-muted)] text-caption'>
          Your personal API key searches with your document access.
        </p>
      </div>
      {!apiKey && (
        <div>
          <Chip
            variant='primary'
            disabled={!viewer.canUsePersonalApiKeys}
            onClick={() => setCreateKeyOpen(true)}
          >
            Generate API key
          </Chip>
          {!viewer.canUsePersonalApiKeys && (
            <p className='mt-2 text-[var(--text-muted)] text-caption'>
              Personal API keys are disabled by your organization.
            </p>
          )}
        </div>
      )}
      <CreateApiKeyModal
        open={createKeyOpen}
        onOpenChange={setCreateKeyOpen}
        allowPersonalApiKeys={viewer.canUsePersonalApiKeys}
        onKeyCreated={(key) => setApiKey(key.key)}
      />
    </div>
  )
}
