'use client'

import { useMemo } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import { useRouter } from 'next/navigation'
import { HELP_REQUEST_TYPES } from '@/lib/api/contracts/common'
import { getDesktopUpdates, isDesktopApp } from '@/lib/desktop'
import {
  ACCEPTED_HELP_IMAGE_TYPES,
  compressHelpImage,
  HELP_REQUEST_TYPE_OPTIONS,
  submitHelpRequest,
  validateHelpImage,
} from '@/lib/help/request'
import { DOCS_URL, SLACK_COMMUNITY_URL } from '@/lib/help-links'
import { captureClientEvent } from '@/lib/posthog/client'
import { toast } from '@/lib/toast/sink'
import { LOGO_ACCEPT_ATTRIBUTE } from '@/lib/uploads/client/logo-file'
import { useRenameOrganization } from '@/hooks/queries/organization'
import { useUploadOrganizationLogo } from '@/hooks/queries/organization-logo'
import {
  desktopUpdateActionLabel,
  hasAvailableDesktopUpdate,
  useDesktopUpdateState,
} from '@/hooks/use-desktop-update-state'
import type { ShellHelp, ShellOrganizationActions } from '@/platform/lib/data/models/shell'
import { type PlatformOrganization, surfaceHref } from '@/platform/lib/data/organization-model'
import { signOutAndLeave } from '@/platform/lib/data/session'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import type { ShellDestination } from '@/platform/shared/shell'

function useOrganizationActions(organization: PlatformOrganization): ShellOrganizationActions {
  const router = useRouter()
  const { id } = organization.organization
  const { mutateAsync: renameOrganization } = useRenameOrganization()
  const { mutateAsync: uploadLogo } = useUploadOrganizationLogo(id)
  const { isAdmin, canInviteMembers } = organization.viewer
  return useMemo<ShellOrganizationActions>(
    () => ({
      canEditIdentity: isAdmin,
      canInvite: canInviteMembers,
      logoAccept: LOGO_ACCEPT_ATTRIBUTE,
      async rename(name) {
        await renameOrganization({ orgId: id, name })
      },
      async uploadLogo(file) {
        try {
          await uploadLogo(file)
          router.refresh()
        } catch (error) {
          toast.error(getErrorMessage(error, 'Failed to upload logo'))
        }
      },
    }),
    [id, isAdmin, canInviteMembers, renameOrganization, uploadLogo, router]
  )
}

const SUPPORT: ShellHelp['support'] = {
  imageAccept: ACCEPTED_HELP_IMAGE_TYPES.join(','),
  requestTypes: HELP_REQUEST_TYPE_OPTIONS,
  async prepareImage(file) {
    const problem = validateHelpImage(file)
    if (problem) throw new Error(problem)
    return compressHelpImage(file)
  },
  async submit({ type, subject, message, images }) {
    const requestType = HELP_REQUEST_TYPES.find((option) => option === type)
    if (!requestType) throw new Error('Select a request type')
    await submitHelpRequest({ data: { type: requestType, subject, message }, images })
    toast.success('Request sent')
  },
}

/** The only desktop build offered is for macOS. iPadOS reports itself as a Mac, but with touch. */
function canInstallMacApp() {
  if (typeof navigator === 'undefined' || isDesktopApp()) return false
  return /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints <= 1
}

function useHelp(organization: PlatformOrganization): ShellHelp {
  const updateState = useDesktopUpdateState()
  const { hosted } = organization.deployment
  return useMemo<ShellHelp>(
    () => ({
      documentationUrl: DOCS_URL,
      slackUrl: SLACK_COMMUNITY_URL,
      downloadUrl: hosted && canInstallMacApp() ? '/api/desktop/update/download' : undefined,
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
      onLinkOpened: (link) =>
        link === 'documentation'
          ? captureClientEvent('docs_opened', { source: 'help_menu' })
          : captureClientEvent('slack_community_opened', { source: 'help_menu' }),
    }),
    [updateState, hosted]
  )
}

/** The shell actions that need no list: identity, account, help and leaving Settings. */
export function useLiveAccountActions(
  organization: PlatformOrganization,
  destinations: readonly ShellDestination[]
) {
  const organizationActions = useOrganizationActions(organization)
  const help = useHelp(organization)
  const landing =
    destinations.find((item) => item.id !== 'settings')?.value ??
    surfaceHref(organization, '/settings')
  const { anonymous } = organization.navFlags
  return useMemo(
    () => ({
      organization: organizationActions,
      help,
      signOut: anonymous
        ? undefined
        : () =>
            void signOutAndLeave('/login?fromLogout=true').then((left) => {
              if (!left) toast.error('Failed to sign out. Please try again.')
            }),
      requestLeave: requestSettingsLeave,
      settingsLanding: landing,
    }),
    [organizationActions, help, anonymous, landing]
  )
}
