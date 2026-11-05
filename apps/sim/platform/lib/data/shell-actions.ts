'use client'

import { toast } from '@sim/emcn'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { usePostHog } from 'posthog-js/react'
import { signOutAndRedirect } from '@/lib/auth/sign-out'
import { getDesktopUpdates, isDesktopApp } from '@/lib/desktop'
import {
  ACCEPTED_HELP_IMAGE_TYPES,
  compressHelpImage,
  HELP_REQUEST_TYPE_OPTIONS,
  submitHelpRequest,
  validateHelpImage,
} from '@/lib/help/request'
import { DOCS_URL, SLACK_COMMUNITY_URL } from '@/lib/help-links'
import { rememberSettingsReturnUrl } from '@/lib/navigation/settings-return'
import { captureEvent } from '@/lib/posthog/client'
import { LOGO_ACCEPT_ATTRIBUTE } from '@/lib/uploads/client/logo-file'
import { useRenameOrganization } from '@/hooks/queries/organization'
import { useUploadOrganizationLogo } from '@/hooks/queries/organization-logo'
import {
  desktopUpdateActionLabel,
  hasAvailableDesktopUpdate,
  useDesktopUpdateState,
} from '@/hooks/use-desktop-update-state'
import type {
  ShellHelp,
  ShellOrganizationActions,
  ShellSupport,
} from '@/platform/app/(shell)/_components/model'
import { openLinkInNewTab } from '@/platform/app/(shell)/_components/sidebar/row-links'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const SUPPORT: ShellSupport = {
  imageAccept: ACCEPTED_HELP_IMAGE_TYPES.join(','),
  requestTypes: HELP_REQUEST_TYPE_OPTIONS,
  async prepareImage(file) {
    const problem = validateHelpImage(file)
    if (problem) throw new Error(problem)
    return compressHelpImage(file)
  },
  async submit({ type, subject, message, images }) {
    const requestType = HELP_REQUEST_TYPE_OPTIONS.find((option) => option.value === type)
    if (!requestType) throw new Error('Select a request type')
    await submitHelpRequest({ data: { type: requestType.value, subject, message }, images })
    toast.success('Request sent')
  },
}

function useHelp(hosted: boolean): ShellHelp {
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
    changelogUrl: hosted ? '/changelog' : undefined,
    downloadUrl: hosted && !isDesktopApp() ? '/api/desktop/update/download' : undefined,
    desktopUpdate: hasAvailableDesktopUpdate(updateState)
      ? {
          label: desktopUpdateActionLabel(updateState),
          disabled: updateState.status === 'downloading',
          run: () => {
            const updates = getDesktopUpdates()
            if (updateState.status === 'ready') updates?.install()
            else if (updateState.status === 'available') updates?.check()
          },
        }
      : undefined,
    support: SUPPORT,
  }
}

function useOrganizationActions(
  organizationId: string,
  viewer: { isAdmin: boolean; canInviteMembers: boolean }
): ShellOrganizationActions {
  const router = useRouter()
  const { mutateAsync: renameOrganization } = useRenameOrganization()
  const { mutateAsync: uploadLogo } = useUploadOrganizationLogo(organizationId)
  return {
    canEditIdentity: viewer.isAdmin,
    canInvite: viewer.canInviteMembers,
    logoAccept: LOGO_ACCEPT_ATTRIBUTE,
    async rename(name) {
      await renameOrganization({ orgId: organizationId, name })
    },
    async uploadLogo(file) {
      try {
        await uploadLogo(file)
        router.refresh()
      } catch (error) {
        toast.error(getErrorMessage(error, 'Failed to upload logo'))
      }
    },
  }
}

interface AccountActionsInput {
  organizationId: string
  hosted: boolean
  viewer: { isAdmin: boolean; canInviteMembers: boolean }
}

/** The shell actions that need no list: identity, help, signing out and leaving Settings. */
export function useAccountActions({ organizationId, hosted, viewer }: AccountActionsInput) {
  const router = useRouter()
  const organization = useOrganizationActions(organizationId, viewer)
  const help = useHelp(hosted)
  const requestLeave = (leave: () => void) => useSettingsDirtyStore.getState().requestLeave(leave)
  return {
    organization,
    help,
    requestLeave,
    signOut: () => requestLeave(() => void signOutAndRedirect(router.push)),
    navigate: (href: string) =>
      requestLeave(() => {
        rememberSettingsReturnUrl(href)
        router.push(href)
      }),
  }
}
