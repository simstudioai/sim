'use client'

import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { signOutAndRedirect } from '@/lib/auth/sign-out'
import { isDesktopApp } from '@/lib/desktop'
import { DOCS_URL, SLACK_COMMUNITY_URL } from '@/lib/help-links'
import { rememberSettingsReturnUrl } from '@/lib/navigation/settings-return'
import { captureEvent } from '@/lib/posthog/client'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useRenameOrganization } from '@/hooks/queries/organization'
import { useUploadOrganizationLogo } from '@/hooks/queries/organization-logo'
import {
  desktopUpdateActionLabel,
  hasAvailableDesktopUpdate,
  runDesktopUpdateAction,
  useDesktopUpdateState,
} from '@/hooks/use-desktop-update-state'
import type { ShellActions } from '@/platform/app/(shell)/_components/model'
import { openLinkInNewTab } from '@/platform/app/(shell)/_components/sidebar/row-links'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

export function useHelp() {
  const { deployment } = useOrganizationContext()
  const posthog = usePostHog()
  const updateState = useDesktopUpdateState()
  return {
    openDocumentation() {
      openLinkInNewTab(DOCS_URL)
      captureEvent(posthog, 'docs_opened', { source: 'help_menu' })
    },
    joinSlack() {
      openLinkInNewTab(SLACK_COMMUNITY_URL)
      captureEvent(posthog, 'slack_community_opened', { source: 'help_menu' })
    },
    changelogUrl: deployment.hosted ? '/changelog' : undefined,
    downloadUrl: deployment.hosted && !isDesktopApp() ? '/api/desktop/update/download' : undefined,
    desktopUpdate: hasAvailableDesktopUpdate(updateState)
      ? {
          label: desktopUpdateActionLabel(updateState),
          disabled: updateState.status === 'downloading',
          run: () => runDesktopUpdateAction(updateState),
        }
      : undefined,
  }
}

export function useOrganizationActions() {
  const { organization, viewer } = useOrganizationContext()
  const router = useRouter()
  const { mutateAsync: renameOrganization, isPending: isRenaming } = useRenameOrganization()
  const { mutateAsync: uploadLogo, isPending: isUploadingLogo } = useUploadOrganizationLogo(
    organization.id
  )
  return {
    canEditIdentity: viewer.isAdmin,
    canInvite: viewer.canInviteMembers,
    isRenaming,
    isUploadingLogo,
    async rename(name: string) {
      await renameOrganization({ orgId: organization.id, name })
    },
    async uploadLogo(file: File) {
      try {
        await uploadLogo(file)
        router.refresh()
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to upload logo'))
      }
    },
  }
}

export function useShellActions(): ShellActions {
  const router = useRouter()
  const requestLeave = (leave: () => void) => useSettingsDirtyStore.getState().requestLeave(leave)
  return {
    requestLeave,
    signOut: () => requestLeave(() => void signOutAndRedirect(router.push)),
    navigate: (href) =>
      requestLeave(() => {
        rememberSettingsReturnUrl(href)
        router.push(href)
      }),
  }
}
