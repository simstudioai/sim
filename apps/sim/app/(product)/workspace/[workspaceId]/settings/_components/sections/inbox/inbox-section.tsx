'use client'

import { SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import {
  FieldStack,
  Muted,
  SectionStack,
} from '@/app/(product)/_components/settings-parts/settings-parts'
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

  if (isPending) return null

  if (config === undefined)
    return (
      <FailureNotice
        message={getErrorMessage(error, 'Failed to load Inbox settings')}
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    )

  if (locked || !config.entitled) {
    // An administrator can still turn off an inbox the plan no longer includes.
    if (config.enabled && isAdmin)
      return (
        <InboxEnableToggle
          workspaceId={workspaceId}
          enabled={config.enabled}
          address={config.address}
        />
      )
    return (
      <UpgradeNotice
        title='Sim Mailer requires an active Max plan'
        description='Upgrade to Max and ensure billing is active to receive tasks via email and let Sim work on your behalf.'
        canUpgrade={isAdmin}
      />
    )
  }

  return (
    <SectionStack>
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
      {config.enabled && (
        <SettingsSection title='Inbox'>
          <FieldStack>
            <Muted>Email tasks received by this workspace.</Muted>
            <InboxTaskList workspaceId={workspaceId} address={config.address} />
          </FieldStack>
        </SettingsSection>
      )}
    </SectionStack>
  )
}
