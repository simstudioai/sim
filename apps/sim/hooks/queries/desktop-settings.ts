'use client'

import type { BrowserCredentialMetadata, ComputerUseAppPermission } from '@sim/desktop-bridge'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDesktopBridge } from '@/lib/desktop'

/** Device data the desktop settings pages read through the shell, never the server. */
const desktopSettingsKeys = {
  all: ['desktop-settings'] as const,
  browserCredentials: () => [...desktopSettingsKeys.all, 'browser-credentials'] as const,
  approvedApps: () => [...desktopSettingsKeys.all, 'approved-apps'] as const,
  approvedAppsDuring: (activeApp: string | null) =>
    [...desktopSettingsKeys.approvedApps(), activeApp ?? ''] as const,
}

/** The built-in browser saves logins outside this page, so the list reads again when it opens. */
const BROWSER_CREDENTIALS_STALE_TIME = 0
/** Apps are approved from a chat, outside this page, so the list reads again on focus. */
const APPROVED_APPS_STALE_TIME = 0

/** Saved browser logins, without passwords; none when this device cannot store them securely. */
export function useBrowserCredentials() {
  return useQuery({
    queryKey: desktopSettingsKeys.browserCredentials(),
    // rq-lint-allow: a preload IPC call cannot be aborted
    queryFn: async (): Promise<BrowserCredentialMetadata[]> => {
      const credentials = getDesktopBridge()?.browserCredentials
      if (!credentials || !(await credentials.isAvailable())) return []
      return credentials.list()
    },
    staleTime: BROWSER_CREDENTIALS_STALE_TIME,
  })
}

/** Reads the saved logins again, after an import added to them. */
export function useRefreshBrowserCredentials() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: desktopSettingsKeys.browserCredentials() })
}

function savedPasswords() {
  const credentials = getDesktopBridge()?.browserCredentials
  if (!credentials) throw new Error('Saved passwords are not available on this device')
  return credentials
}

/** Deletes one saved login (`id`) or, with no id, every one; the shell answers with what remains. */
export function useDeleteBrowserCredentials() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id?: string) =>
      id === undefined ? savedPasswords().forgetAll() : savedPasswords().forget(id),
    onSuccess: (remaining) =>
      queryClient.setQueryData(desktopSettingsKeys.browserCredentials(), remaining),
  })
}

/**
 * The Mac apps Computer Use may drive. An action in `activeApp` can approve a new app, so the list
 * reads again when the app in use changes.
 */
export function useApprovedApps(activeApp: string | null, enabled: boolean) {
  return useQuery({
    queryKey: desktopSettingsKeys.approvedAppsDuring(activeApp),
    // rq-lint-allow: a preload IPC call cannot be aborted
    queryFn: (): Promise<ComputerUseAppPermission[]> => {
      const computerUse = getDesktopBridge()?.computerUse
      if (!computerUse) throw new Error('Computer use is not available on this device')
      return computerUse.listAppPermissions()
    },
    enabled,
    staleTime: APPROVED_APPS_STALE_TIME,
    placeholderData: keepPreviousData,
  })
}

export function useRevokeApp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (bundleId: string) => {
      const computerUse = getDesktopBridge()?.computerUse
      if (!computerUse) throw new Error('Computer use is not available on this device')
      await computerUse.revokeApp(bundleId)
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: desktopSettingsKeys.approvedApps() }),
  })
}
