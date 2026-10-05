'use client'

import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSettingsIntentHandler } from '@/components/settings/settings-navigation-provider'
import { SettingsPendingSection } from '@/components/settings/settings-pending-section'
import { useSettingsBeforeUnload } from '@/components/settings/use-settings-before-unload'
import { useWorkspaceHostContext } from '@/app/workspace/[workspaceId]/providers/workspace-host-provider'
import {
  resolveSettingsSection,
  type SettingsSection,
} from '@/app/workspace/[workspaceId]/settings/navigation'
import { warmSettingsSection } from '@/app/workspace/[workspaceId]/settings/section-warmers'

function pendingSectionMeta(section: string) {
  return resolveSettingsSection(section)?.meta ?? null
}

/**
 * Persists across every settings route — sections and detail pages alike — so it owns what the
 * sidebar needs while any of them is open: the pending-section preview and the warmer that
 * sidebar navigation intent runs.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  useSettingsBeforeUnload()
  const queryClient = useQueryClient()
  const hostContext = useWorkspaceHostContext()
  const workspaceId = hostContext.workspace.id
  const billingOrganizationId = hostContext.hostOrganizationId

  useSettingsIntentHandler(
    useCallback(
      (section: string) =>
        warmSettingsSection(
          queryClient,
          { workspaceId, billingOrganizationId },
          section as SettingsSection
        ),
      [queryClient, workspaceId, billingOrganizationId]
    )
  )

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      <SettingsPendingSection resolveMeta={pendingSectionMeta}>{children}</SettingsPendingSection>
    </div>
  )
}
