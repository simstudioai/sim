'use client'

import { Chip } from '@sim/emcn'
import { ArrowRight } from 'lucide-react'
import { useParams } from 'next/navigation'
import { canMutateWorkspaceSettingsSection } from '@/components/settings/navigation'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  InboxEnableToggle,
  InboxSettingsTab,
  InboxTaskList,
} from '@/app/workspace/[workspaceId]/settings/components/inbox/components'
import { SettingsPanel } from '@/app/workspace/[workspaceId]/settings/components/settings-panel'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useInboxConfig } from '@/hooks/queries/inbox'
import { useSettingsNavigation } from '@/hooks/use-settings-navigation'

export function Inbox() {
  const params = useParams()
  const { navigateToSettings } = useSettingsNavigation()
  const workspaceId = params.workspaceId as string

  const { data: config, isLoading } = useInboxConfig(workspaceId)
  const workspacePermissions = useUserPermissionsContext()
  const canAdmin = canMutateWorkspaceSettingsSection('inbox', workspacePermissions)

  if (isLoading) {
    return null
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
      <div className='flex h-full flex-col bg-[var(--bg)]'>
        <div className='min-h-0 flex-1 overflow-y-auto px-6 [scrollbar-gutter:stable_both-edges]'>
          <div className='mx-auto flex max-w-[48rem] flex-col gap-4.5 pt-6 pb-6'>
            <div className='flex flex-col items-center justify-center gap-4 py-20'>
              <div className='text-center'>
                <h3 className='font-medium text-[var(--text-primary)] text-md'>
                  Sim Mailer requires an active Max plan
                </h3>
                <p className='mt-1.5 text-[var(--text-muted)] text-sm'>
                  Upgrade to Max and ensure billing is active to receive tasks via email and let Sim
                  work on your behalf.
                </p>
              </div>
              {canAdmin && (
                <Chip
                  variant='primary'
                  rightIcon={ArrowRight}
                  onClick={() => navigateToSettings({ section: 'billing' })}
                >
                  Upgrade to Max
                </Chip>
              )}
            </div>
          </div>
        </div>
      </div>
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
