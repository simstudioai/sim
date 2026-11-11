'use client'

import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { SettingsPageHeader } from '@/app/(product)/_components/settings-parts/settings-page'
import { SectionStack } from '@/app/(product)/_components/settings-parts/settings-parts'
import type { WorkspaceSettingsSectionProps } from '@/app/(product)/workspace/[workspaceId]/settings/_components/section-registry'
import { InboxEnableToggle } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/inbox/inbox-enable-toggle'
import { InboxSettings } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/inbox/inbox-settings'
import { InboxTaskList } from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/inbox/inbox-task-list'
import { UpgradeNotice } from '@/app/(product)/workspace/[workspaceId]/settings/_components/upgrade-notice/upgrade-notice'
import { useInboxConfig } from '@/platform/lib/data/inbox'
import { useWorkspaceSettingsSection } from '@/platform/lib/data/workspace-settings'

/** Sim Mailer: the workspace's email inbox, who may write to it, and the tasks it received. */
export default function InboxSection({ workspaceId }: WorkspaceSettingsSectionProps) {
  const { canMutate, locked, permission } = useWorkspaceSettingsSection(workspaceId, 'inbox')
  const { data: config, isPending, error, isFetching, refetch } = useInboxConfig(workspaceId)
  const isAdmin = permission === 'admin'

  if (isPending) return <SettingsPageHeader />

  if (config === undefined)
    return (
      <SectionStack>
        <SettingsPageHeader />
        <FailureNotice
          message={getErrorMessage(error, 'Couldn’t load Sim Mailer settings')}
          retrying={isFetching}
          onRetry={() => void refetch()}
        />
      </SectionStack>
    )

  if (locked || !config.entitled) {
    return (
      <SectionStack>
        <SettingsPageHeader />
        {config.enabled && isAdmin ? (
          // An administrator can still turn off an inbox the plan no longer includes.
          <InboxEnableToggle
            workspaceId={workspaceId}
            enabled={config.enabled}
            address={config.address}
          />
        ) : (
          <UpgradeNotice
            title='Sim Mailer requires an active Max plan'
            description='Upgrade to Max to send Sim tasks by email'
            canUpgrade={isAdmin}
          />
        )}
      </SectionStack>
    )
  }

  return (
    <SectionStack>
      <SettingsPageHeader />
      {canMutate && (
        <InboxEnableToggle
          workspaceId={workspaceId}
          enabled={config.enabled}
          address={config.address}
        />
      )}
      {config.enabled && canMutate && (
        <InboxSettings
          workspaceId={workspaceId}
          address={config.address}
          secretScope={config.secretScope}
          mountedSecrets={config.mountedSecrets}
        />
      )}
      {config.enabled && <InboxTaskList workspaceId={workspaceId} address={config.address} />}
    </SectionStack>
  )
}
