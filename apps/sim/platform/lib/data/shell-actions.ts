'use client'

import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { clearBrowserUserData } from '@/lib/auth/browser-storage'
import { signOut } from '@/lib/auth/client'
import { getDesktopUpdates, isDesktopApp } from '@/lib/desktop'
import {
  ACCEPTED_HELP_IMAGE_TYPES,
  compressHelpImage,
  HELP_REQUEST_TYPE_OPTIONS,
  MAX_HELP_IMAGE_BYTES,
  submitHelpRequest,
} from '@/lib/help/request'
import { DOCS_URL, SLACK_COMMUNITY_URL } from '@/lib/help-links'
import { LOGO_ACCEPT_ATTRIBUTE } from '@/lib/uploads/client/logo-file'
import { useRenameOrganization } from '@/hooks/queries/organization'
import { useUploadOrganizationLogo } from '@/hooks/queries/organization-logo'
import { useDesktopUpdateState } from '@/hooks/use-desktop-update-state'
import type {
  ShellDestination,
  ShellHelp,
  ShellOrganizationActions,
} from '@/platform/app/(shell)/_components/model'
import type { PlatformOrganization } from '@/platform/lib/data/organization-model'
import { toast } from '@/platform/lib/data/toast'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

const logger = createLogger('PlatformShellActions')

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
      await uploadLogo(file)
      router.refresh()
    },
  }
}

function desktopUpdateLabel(state: ReturnType<typeof useDesktopUpdateState>): string {
  if (state.status === 'downloading')
    return state.percent === undefined
      ? 'Downloading update…'
      : `Downloading update ${state.percent}%`
  return state.status === 'ready' ? 'Restart to update' : 'Update'
}

function useHelp(organization: PlatformOrganization): ShellHelp {
  const updateState = useDesktopUpdateState()
  const { hosted } = organization.deployment
  const updateAvailable =
    updateState.status === 'available' ||
    updateState.status === 'downloading' ||
    updateState.status === 'ready'
  return {
    documentationUrl: DOCS_URL,
    slackUrl: SLACK_COMMUNITY_URL,
    changelogUrl: hosted ? `${organization.legacyOrigin}/changelog` : undefined,
    downloadUrl:
      hosted && !isDesktopApp()
        ? `${organization.legacyOrigin}/api/desktop/update/download`
        : undefined,
    desktopUpdate: updateAvailable
      ? {
          label: desktopUpdateLabel(updateState),
          disabled: updateState.status === 'downloading',
          run: () => {
            const updates = getDesktopUpdates()
            if (updateState.status === 'ready') updates?.install()
            else if (updateState.status === 'available') updates?.check()
          },
        }
      : undefined,
    support: {
      imageAccept: ACCEPTED_HELP_IMAGE_TYPES.join(','),
      requestTypes: HELP_REQUEST_TYPE_OPTIONS,
      async prepareImage(file) {
        if (file.size > MAX_HELP_IMAGE_BYTES) throw new Error('Images must be 20MB or smaller.')
        if (!ACCEPTED_HELP_IMAGE_TYPES.includes(file.type))
          throw new Error('Attach a JPEG, PNG, WebP or GIF image.')
        return compressHelpImage(file)
      },
      async submit({ type, subject, message, images }) {
        await submitHelpRequest({ data: { type, subject, message }, images })
        toast.success('Request sent')
      },
    },
  }
}

/**
 * Signs out, clears this viewer's browser storage, then leaves for login. A failed sign-out stays
 * here with a notice: the cookies survive, so login would bounce straight back.
 */
async function signOutOfPlatform(legacyOrigin: string) {
  try {
    await signOut()
  } catch (error) {
    logger.error('Failed to sign out', { error })
    toast.error('Failed to sign out. Please try again.')
    return
  }
  clearBrowserUserData()
  window.location.assign(`${legacyOrigin}/login?fromLogout=true`)
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
      : () => void signOutOfPlatform(organization.legacyOrigin),
    requestLeave: (leave: () => void) => {
      useSettingsDirtyStore.getState().requestLeave(leave)
    },
    settingsReturn: (entry: string | null) => entry ?? landing,
  }
}
