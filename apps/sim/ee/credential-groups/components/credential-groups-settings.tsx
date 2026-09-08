'use client'

import { ChipTag } from '@sim/emcn'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { OrganizationConnectedAccounts } from '@/ee/credential-groups/components/organization-connected-accounts'
import { useWorkspaceOrganizationAccounts } from '@/hooks/queries/organization-accounts'

interface CredentialGroupsSettingsProps {
  workspaceId: string
}

/** Embeds the organization manager for its admins; other workspace viewers see sharing status. */
export function CredentialGroupsSettings({ workspaceId }: CredentialGroupsSettingsProps) {
  const accounts = useWorkspaceOrganizationAccounts(workspaceId)
  const data = accounts.data
  return (
    <SettingsPanel>
      {accounts.error ? (
        <SettingsQueryErrorState
          error={accounts.error}
          fallback='Could not load connected accounts'
          isRetrying={accounts.isFetching}
          onRetry={() => void accounts.refetch()}
        />
      ) : data?.available && data.canManage && data.organizationId ? (
        <OrganizationConnectedAccounts
          key={data.organizationId}
          organizationId={data.organizationId}
        />
      ) : data ? (
        <div className='flex flex-col gap-4'>
          <p className='text-[var(--text-body)] text-small'>
            {data.organizationName
              ? `Connected accounts are managed by ${data.organizationName}.`
              : 'This workspace must belong to an organization to use organization accounts.'}
          </p>
          <div>
            <ChipTag>{data.allowed ? 'Access allowed' : 'Access not granted'}</ChipTag>
          </div>
          <p className='text-[var(--text-muted)] text-caption'>
            {data.allowed
              ? 'All authorized manual and deployed workflows in this workspace can use every active organization account through the Credential block.'
              : 'An organization admin must grant this workspace access before workflows can use organization accounts.'}
          </p>
        </div>
      ) : (
        <p className='text-[var(--text-muted)] text-caption'>Loading connected accounts…</p>
      )}
    </SettingsPanel>
  )
}
