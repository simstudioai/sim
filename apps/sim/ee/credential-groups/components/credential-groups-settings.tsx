'use client'

import { useEffect } from 'react'
import { SettingsQueryErrorState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { CredentialGroupDetail } from '@/ee/credential-groups/components/credential-group-detail'
import { useEnsureWorkspaceAccounts, useWorkspaceAccounts } from '@/hooks/queries/credential-groups'

interface CredentialGroupsSettingsProps {
  workspaceId: string
}

export function CredentialGroupsSettings({ workspaceId }: CredentialGroupsSettingsProps) {
  return <WorkspaceAccounts key={workspaceId} workspaceId={workspaceId} />
}

function WorkspaceAccounts({ workspaceId }: CredentialGroupsSettingsProps) {
  const accounts = useWorkspaceAccounts(workspaceId)
  const {
    mutate: ensureAccounts,
    data: preparedAccounts,
    error: setupError,
    isIdle: setupIdle,
    isPending: setupPending,
  } = useEnsureWorkspaceAccounts()
  const prepared = preparedAccounts?.credentialGroup
  const credentialGroup =
    accounts.data?.credentialGroup ?? (prepared?.workspaceId === workspaceId ? prepared : undefined)
  const needsSetup = accounts.isSuccess && !credentialGroup

  /** Existing workspaces prepare their account container on first use. */
  useEffect(() => {
    if (needsSetup && setupIdle) ensureAccounts({ workspaceId })
  }, [ensureAccounts, needsSetup, setupIdle, workspaceId])

  if (credentialGroup) {
    return <CredentialGroupDetail workspaceId={workspaceId} groupId={credentialGroup.id} />
  }

  const error = accounts.error ?? setupError
  return (
    <SettingsPanel>
      {error ? (
        <SettingsQueryErrorState
          error={error}
          fallback="Couldn't load connected accounts"
          isRetrying={setupPending || accounts.isFetching}
          onRetry={() =>
            accounts.error ? void accounts.refetch() : ensureAccounts({ workspaceId })
          }
        />
      ) : null}
    </SettingsPanel>
  )
}
