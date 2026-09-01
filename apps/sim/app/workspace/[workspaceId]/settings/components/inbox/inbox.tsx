'use client'

import { getErrorMessage } from '@sim/utils/errors'
import { useParams } from 'next/navigation'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  InboxEnableToggle,
  InboxSettingsTab,
  InboxTaskList,
} from '@/app/workspace/[workspaceId]/settings/components/inbox/components'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { SettingsUpgradeNotice } from '@/app/workspace/[workspaceId]/settings/components/settings-upgrade-notice'
import { useInboxConfig } from '@/hooks/queries/inbox'

export function Inbox() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: config, isLoading, error } = useInboxConfig(workspaceId)
  const workspacePermissions = useUserPermissionsContext()
  const canAdmin = canMutateWorkspaceSettingsSection('inbox', workspacePermissions)

  if (isLoading) {
    return null
  }

  if (error && config === undefined) {
    return (
      <SettingsPanel>
        <SettingsEmptyState tone='error'>
          {getErrorMessage(error, 'Failed to load Inbox settings')}
        </SettingsEmptyState>
      </SettingsPanel>
    )
  }

  if (!config?.entitled) {
    if (config?.enabled && canAdmin) {
      return (
        <SettingsPanel>
          <InboxEnableToggle />
        </SettingsPanel>
      )
    }
    return (
      <SettingsPanel>
        <SettingsUpgradeNotice
          title='Sim Mailer requires an active Max plan'
          description='Upgrade to Max and ensure billing is active to receive tasks via email and let Sim work on your behalf.'
          canUpgrade={canAdmin}
        />
      </SettingsPanel>
    )
  }

  return (
    <SettingsPanel>
      {canAdmin && <InboxEnableToggle />}

      {config?.enabled && (
        <>
          {canAdmin && <InboxSettingsTab />}

          <SettingsSection label='Inbox'>
            <p className='mb-3 text-[var(--text-muted)] text-caption'>
              Email tasks received by this workspace.
            </p>
            <InboxTaskList />
          </SettingsSection>
        </>
      )}
    </SettingsPanel>
  )
}
