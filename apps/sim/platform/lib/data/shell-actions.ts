'use client'

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
import { toast } from '@/lib/toast/sink'
import { LOGO_ACCEPT_ATTRIBUTE } from '@/lib/uploads/client/logo-file'
import { useRenameOrganization } from '@/hooks/queries/organization'
import { useUploadOrganizationLogo } from '@/hooks/queries/organization-logo'
import {
  desktopUpdateActionLabel,
  hasAvailableDesktopUpdate,
  useDesktopUpdateState,
} from '@/hooks/use-desktop-update-state'
import type { ShellHelp, ShellOrganizationActions } from '@/platform/app/(shell)/_components/model'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { signOutAndLeave } from '@/platform/lib/data/session'
import { requestSettingsLeave } from '@/platform/lib/data/settings-guard'
import type { ShellDestination } from '@/platform/shared/shell'

function useOrganizationActions(organization: PlatformOrganization): ShellOrganizationActions {
  const router = useRouter()
  const { id } = organization.organization
  const { mutateAsync: renameOrganization } = useRenameOrganization()
  const { mutateAsync: uploadLogo } = useUploadOrganizationLogo(id)
  return {
    canEditIdentity: organization.viewer.isAdmin,
    canInvite: organization.viewer.canInviteMembers,
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
  }
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

function useHelp(organization: PlatformOrganization): ShellHelp {
  const updateState = useDesktopUpdateState()
  const { hosted } = organization.deployment
  return {
    documentationUrl: DOCS_URL,
    slackUrl: SLACK_COMMUNITY_URL,
    downloadUrl:
      hosted && !isDesktopApp()
        ? `${organization.legacyOrigin}/api/desktop/update/download`
        : undefined,
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

/** The shell actions that need no list: identity, account, help and leaving Settings. */
export function useLiveAccountActions(
  organization: PlatformOrganization,
  destinations: readonly ShellDestination[]
) {
  const organizationActions = useOrganizationActions(organization)
  const help = useHelp(organization)
  const landing = destinations.find((item) => item.id !== 'settings')?.value ?? '/settings'
  return {
    organization: organizationActions,
    help,
    signOut: organization.navFlags.anonymous
      ? undefined
      : () =>
          void signOutAndLeave(`${organization.legacyOrigin}/login?fromLogout=true`).then(
            (left) => {
              if (!left) toast.error('Failed to sign out. Please try again.')
            }
          ),
    requestLeave: requestSettingsLeave,
    settingsLanding: landing,
  }
}
