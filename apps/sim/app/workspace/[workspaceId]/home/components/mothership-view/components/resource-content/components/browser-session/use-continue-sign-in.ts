'use client'

import { useCallback, useSyncExternalStore } from 'react'
import type { BrowserContinueSignInError, BrowserImportProfile } from '@sim/desktop-bridge'
import { toast } from '@sim/emcn'
import { IMPORT_ERROR_MESSAGES } from '@/components/browser-import/browser-import-dialog'
import {
  parseHttpsPage,
  signInHintHost,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/sign-in-hosts'
import {
  supportsContinueSignIn,
  useBringSignInBack,
  useBrowserImportProfiles,
  useCancelSignInHandoff,
  usePendingSignIn,
  useStartSignInHandoff,
} from '@/hooks/queries/browser-import'

const CONTINUE_ERROR_MESSAGES: Record<BrowserContinueSignInError, string> = {
  'chrome-not-found': IMPORT_ERROR_MESSAGES['chrome-not-found'],
  'unsupported-page': 'This page can’t be continued in another browser.',
  'launch-failed': 'Could not open that browser.',
  unknown: 'Could not open this page in another browser.',
}

/** Hosts whose hint the user dismissed, for as long as the app stays open. */
const dismissedHintHosts = new Set<string>()
const dismissalListeners = new Set<() => void>()

function subscribeToDismissals(listener: () => void): () => void {
  dismissalListeners.add(listener)
  return () => {
    dismissalListeners.delete(listener)
  }
}

const dismissalCount = () => dismissedHintHosts.size

interface UseContinueSignInProps {
  scopeId: string
  pageUrl: string | undefined
}

/**
 * Finishing a sign-in in the user's own browser and bringing the session back
 * (see `continueSignIn` on the desktop bridge). A shell without the bridge
 * methods, a platform without the importer, or a device with no importable
 * browser leaves `canContinue` false, and every surface built on this hides.
 */
export function useContinueSignIn({ scopeId, pageUrl }: UseContinueSignInProps) {
  const supported = supportsContinueSignIn()
  const { data: profiles = [] } = useBrowserImportProfiles(supported)
  const { data: pendingData = null } = usePendingSignIn(scopeId, supported)
  const pending = supported ? pendingData : null
  const { mutateAsync: startHandoff, isPending: starting } = useStartSignInHandoff(scopeId)
  const { mutateAsync: importBack, isPending: importing } = useBringSignInBack(scopeId)
  const { mutate: cancelHandoff } = useCancelSignInHandoff(scopeId)
  useSyncExternalStore(subscribeToDismissals, dismissalCount, dismissalCount)

  const page = parseHttpsPage(pageUrl)
  // The profiles cache is shared with the import dialog, which older shells
  // also support, so cached profiles alone must not reveal this feature.
  const canContinue = supported && profiles.length > 0 && page !== null
  const hintHost = page ? signInHintHost(page) : null
  const hintVisible =
    canContinue && pending === null && hintHost !== null && !dismissedHintHosts.has(hintHost)

  const continueIn = useCallback(
    async (profile: BrowserImportProfile) => {
      try {
        const result = await startHandoff(profile.id)
        if (result.error) toast.error(CONTINUE_ERROR_MESSAGES[result.error])
      } catch {
        toast.error(CONTINUE_ERROR_MESSAGES.unknown)
      }
    },
    [startHandoff]
  )

  const bringBack = useCallback(async () => {
    if (!pending) return
    const { site, browserLabel } = pending
    try {
      const result = await importBack()
      if (result.error) {
        toast.error(IMPORT_ERROR_MESSAGES[result.error])
      } else if (result.cookiesImported === 0) {
        toast.warning(
          `No sign-in for ${site} found in ${browserLabel}. Make sure you finished signing in.`
        )
      } else {
        toast.success(`Brought back your ${site} session from ${browserLabel}`)
      }
    } catch {
      toast.error(IMPORT_ERROR_MESSAGES.unknown)
    }
  }, [importBack, pending])

  const cancel = useCallback(() => cancelHandoff(), [cancelHandoff])

  const dismissHint = useCallback(() => {
    if (!hintHost) return
    dismissedHintHosts.add(hintHost)
    for (const listener of dismissalListeners) listener()
  }, [hintHost])

  return {
    profiles,
    canContinue,
    pending,
    starting,
    importing,
    hintVisible,
    continueIn,
    bringBack,
    cancel,
    dismissHint,
  }
}

export type ContinueSignInController = ReturnType<typeof useContinueSignIn>
