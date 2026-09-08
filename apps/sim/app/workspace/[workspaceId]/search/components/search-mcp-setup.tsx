'use client'

import { useState } from 'react'
import { Chip, ChipModal, ChipModalBody, ChipModalField, ChipModalHeader } from '@sim/emcn'
import { McpIcon } from '@/components/icons'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import { CreateApiKeyModal } from '@/app/workspace/[workspaceId]/settings/components/api-keys/components'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { useUserPermissionConfig } from '@/ee/access-control/hooks/permission-groups'

interface SearchMcpSetupProps {
  workspaceId: string
}

export function SearchMcpSetup({ workspaceId }: SearchMcpSetupProps) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <SettingsResourceRow
        icon={<McpIcon />}
        title='Use Search in other apps via MCP'
        trailing={<Chip onClick={() => setOpen(true)}>Set up</Chip>}
      />
      {open && (
        <SearchMcpModal
          key={workspaceId}
          workspaceId={workspaceId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

interface SearchMcpModalProps extends SearchMcpSetupProps {
  onClose: () => void
}

function SearchMcpModal({ workspaceId, onClose }: SearchMcpModalProps) {
  const { workspace } = useWorkspaceHostContext()
  const policy = useUserPermissionConfig(workspaceId)
  const [createKeyOpen, setCreateKeyOpen] = useState(false)
  const [apiKey, setApiKey] = useState<string | null>(null)
  const allowPersonalApiKeys =
    workspace.allowPersonalApiKeys &&
    policy.isSuccess &&
    !policy.data?.config?.disablePersonalApiKeys
  const endpoint = `${getBaseUrl()}/api/mcp/search/${encodeURIComponent(workspaceId)}`

  return (
    <>
      <ChipModal open onOpenChange={(open) => !open && onClose()} srTitle='Connect Search via MCP'>
        <ChipModalHeader onClose={onClose}>Connect Search via MCP</ChipModalHeader>
        <ChipModalBody>
          <ChipModalField
            type='copy'
            title='Server URL'
            value={endpoint}
            copyLabel='Copy MCP server URL'
            hint='Transport: Streamable HTTP'
          />
          <ChipModalField
            type='copy'
            title='Authorization header'
            value={`Bearer ${apiKey ?? 'YOUR_SIM_API_KEY'}`}
            copyLabel='Copy authorization header value'
            hint='Use a personal API key to search with your document access.'
          />
          {!apiKey && (
            <ChipModalField
              type='custom'
              title='Personal API key'
              hint={
                policy.isSuccess && !allowPersonalApiKeys
                  ? 'Personal API keys are disabled for your account.'
                  : undefined
              }
            >
              {policy.isError ? (
                <SettingsQueryErrorState
                  error={policy.error}
                  fallback='Could not check API-key permissions'
                  isRetrying={policy.isFetching}
                  onRetry={() => void policy.refetch()}
                  variant='inline'
                />
              ) : (
                <Chip onClick={() => setCreateKeyOpen(true)} disabled={!allowPersonalApiKeys}>
                  Generate API key
                </Chip>
              )}
            </ChipModalField>
          )}
        </ChipModalBody>
      </ChipModal>
      <CreateApiKeyModal
        open={createKeyOpen}
        onOpenChange={setCreateKeyOpen}
        workspaceId={workspaceId}
        allowPersonalApiKeys={allowPersonalApiKeys}
        defaultKeyType='personal'
        onKeyCreated={(key) => setApiKey(key.key)}
      />
    </>
  )
}
