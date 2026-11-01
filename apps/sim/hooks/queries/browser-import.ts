'use client'

import type { BrowserImportProfile, BrowserPendingSignIn } from '@sim/desktop-bridge'
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getDesktopBridge } from '@/lib/desktop'

/** Local browser data read through the desktop shell, never the server. */
const browserImportKeys = {
  all: ['browser-import'] as const,
  profiles: () => [...browserImportKeys.all, 'profiles'] as const,
  pendingSignIns: () => [...browserImportKeys.all, 'pending-sign-in'] as const,
  pendingSignIn: (scopeId: string) => [...browserImportKeys.pendingSignIns(), scopeId] as const,
}

/** Browsers are rarely installed or removed mid-session. */
const BROWSER_IMPORT_PROFILES_STALE_TIME = 5 * 60 * 1000
/** The shell owns a pending sign-in, and every change to it goes through the hooks below. */
const PENDING_SIGN_IN_STALE_TIME = Number.POSITIVE_INFINITY

function browserImport() {
  return getDesktopBridge()?.browserImport
}

/** Whether this shell can continue a sign-in in another browser and bring it back. */
export function supportsContinueSignIn(): boolean {
  const api = browserImport()
  return Boolean(
    api?.continueSignIn && api.bringSignInBack && api.cancelSignIn && api.getPendingSignIn
  )
}

/** Browser profiles the shell can import from; empty when there are none. */
export function useBrowserImportProfiles(enabled: boolean) {
  return useQuery({
    queryKey: browserImportKeys.profiles(),
    // rq-lint-allow: a preload IPC call cannot be aborted
    queryFn: (): Promise<BrowserImportProfile[]> => {
      const listProfiles = browserImport()?.listChromeProfiles
      if (!listProfiles) throw new Error('Browser import is not available on this device.')
      return listProfiles()
    },
    enabled,
    staleTime: BROWSER_IMPORT_PROFILES_STALE_TIME,
  })
}

/** The chat's sign-in waiting in another browser, kept by the shell across panel remounts. */
export function usePendingSignIn(scopeId: string, enabled: boolean) {
  return useQuery({
    queryKey: browserImportKeys.pendingSignIn(scopeId),
    // rq-lint-allow: a preload IPC call cannot be aborted
    queryFn: async (): Promise<BrowserPendingSignIn | null> =>
      (await browserImport()?.getPendingSignIn?.(scopeId)) ?? null,
    enabled,
    staleTime: PENDING_SIGN_IN_STALE_TIME,
  })
}

/**
 * Refreshes every chat's pending sign-in, not just the one a mutation started under:
 * a provisional chat id that saves mid-mutation moves the handoff to the saved id.
 */
function invalidatePendingSignIns(queryClient: QueryClient) {
  return queryClient.invalidateQueries({ queryKey: browserImportKeys.pendingSignIns() })
}

export function useStartSignInHandoff(scopeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (profileId: string) => {
      const continueSignIn = browserImport()?.continueSignIn
      if (!continueSignIn) return { error: 'unknown' as const }
      return continueSignIn(profileId, scopeId)
    },
    onSuccess: ({ pending }) => {
      if (pending) queryClient.setQueryData(browserImportKeys.pendingSignIn(scopeId), pending)
    },
    // A failed or superseded launch can still retire the chat's previous
    // handoff, so the shell's answer replaces whatever the cache last held.
    onSettled: () => invalidatePendingSignIns(queryClient),
  })
}

export function useBringSignInBack(scopeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const bringSignInBack = browserImport()?.bringSignInBack
      if (!bringSignInBack) throw new Error('Browser import is not available on this device.')
      return bringSignInBack(scopeId)
    },
    onSuccess: () => invalidatePendingSignIns(queryClient),
  })
}

export function useCancelSignInHandoff(scopeId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => browserImport()?.cancelSignIn?.(scopeId),
    onSuccess: () => queryClient.setQueryData(browserImportKeys.pendingSignIn(scopeId), null),
    onSettled: () => invalidatePendingSignIns(queryClient),
  })
}
