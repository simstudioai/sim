'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from '@sim/emcn'
import { useParams } from 'next/navigation'
import {
  addOAuthChatAttemptToAuthorizeUrl,
  buildOAuthChatCompleteAuthorizeUrl,
  clearActiveDesktopOAuthChatAttempt,
  createOAuthChatAttempt,
  getOAuthCredentialBaseline,
  hasOAuthCredentialChanged,
  hasOAuthCredentialForTarget,
  OAUTH_CHAT_ATTEMPT_EVENT,
  OAUTH_CHAT_ATTEMPT_PARAM,
  type OAuthChatAttempt,
  type OAuthChatAttemptStatus,
  readLatestOAuthChatAttempt,
  readOAuthChatAttempt,
  setActiveDesktopOAuthChatAttempt,
  setOAuthChatAttemptStatus,
} from '@/lib/credentials/oauth-chat-attempt'
import { getDesktopBridge } from '@/lib/desktop'
import { isAppSurfacePath } from '@/lib/navigation/paths'
import type { OAuthProvider } from '@/lib/oauth/types'
import { parseProvider, providerIdsForService } from '@/lib/oauth/utils'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'

const OAUTH_POPUP_WINDOW_NAME = 'sim-oauth-connect'
/** Matches the MCP OAuth popup (`hooks/mcp/use-mcp-oauth-popup.ts`) so the two consent windows open alike. */
const OAUTH_POPUP_FEATURES = 'width=560,height=720,resizable=yes,scrollbars=yes'
/**
 * How often to re-examine a live popup. Matches the MCP OAuth popup's own
 * watcher: a closed or terminal window fires no event in the opener, so
 * polling the handle is the only way to observe it.
 */
const OAUTH_POPUP_POLL_INTERVAL_MS = 400
/** Matches the MCP OAuth popup's safety timeout: bounds a flow whose outcome never becomes observable. */
const OAUTH_POPUP_UNOBSERVABLE_TIMEOUT_MS = 10 * 60 * 1000

/**
 * Better Auth sends pre-state failures (usually a denied consent) to its global
 * error page, which publishes no verdict.
 */
const OAUTH_ERROR_PATH = '/oauth-error'

/**
 * Same-origin pages an OAuth flow can die on without reaching the return leg —
 * the Better Auth error page, or anywhere in the signed-in app, which is where the
 * custom-provider callbacks exit to. The app entry forwards on the server to the
 * organization or a workspace, so any app surface counts, not just the entry
 * itself. None of them publishes a verdict, so a popup sitting on one is finished.
 */
function isOAuthPopupTerminalPath(pathname: string): boolean {
  return pathname === OAUTH_ERROR_PATH || isAppSurfacePath(pathname)
}

/**
 * What the opener can actually prove about a popup it launched. `ended` needs
 * positive evidence: a same-origin page we can read that publishes no verdict.
 * A handle reporting closed is only `unobservable` — COOP disowns the window
 * and the disowned handle reports closed for a consent screen still running.
 */
type PopupObservation = 'live' | 'ended' | 'unobservable'

function observePopup(popup: { window: Window } | null): PopupObservation {
  if (!popup) return 'unobservable'
  let closed: boolean
  try {
    closed = popup.window.closed
  } catch {
    return 'unobservable'
  }
  if (closed) return 'unobservable'
  try {
    const { origin, pathname } = popup.window.location
    if (origin === window.location.origin && isOAuthPopupTerminalPath(pathname)) {
      return 'ended'
    }
  } catch {
    // Reading `location` across origins throws, which is the signal we want:
    // the popup is still on the provider's pages, so the flow is in flight.
  }
  return 'live'
}

/**
 * Whether the popup still owns the flow — i.e. whether the row should keep
 * deferring to it instead of deciding for itself.
 */
function isPopupStillOpen(popup: { window: Window } | null): boolean {
  return observePopup(popup) === 'live'
}

export interface OAuthChipTarget {
  /** Provider the authorize URL connects; falls back to the tag's own slug. */
  providerId: string
  /** Present when the URL re-authorizes an existing credential in place. */
  reconnectCredentialId?: string
}

/**
 * Reads the connect target out of an authorize URL. Shared with the credential
 * card's recap, which has to look up a row's stored attempt without mounting
 * the row — the attempt key is derived from exactly these two fields.
 */
export function resolveOAuthChipTarget(connectUrl?: string, provider?: string): OAuthChipTarget {
  if (!connectUrl) return { providerId: provider ?? '' }
  let url: URL
  try {
    url = new URL(connectUrl)
  } catch {
    return { providerId: provider ?? '' }
  }
  const reconnectCredentialId = url.searchParams.get('credentialId') ?? undefined
  if (url.pathname === '/api/auth/instagram/authorize') {
    return { providerId: 'instagram', reconnectCredentialId }
  }
  if (url.pathname === '/api/auth/shopify/authorize') {
    return { providerId: 'shopify', reconnectCredentialId }
  }
  if (url.pathname === '/api/auth/trello/authorize') {
    return { providerId: 'trello', reconnectCredentialId }
  }
  return { providerId: url.searchParams.get('providerId') ?? provider ?? '', reconnectCredentialId }
}

interface UseOAuthChipConnectionParams {
  /** Authorize URL streamed by the agent; provider and reconnect scope are read from it. */
  connectUrl?: string
  /** Provider slug from the tag, used when the URL carries none. */
  provider?: string
  /** Human-facing integration name, stored on the attempt for its toasts. */
  displayName: string
  /** Identifies the row within the message, so sibling chips stay independent. */
  controlId: string
  onConnected?: () => void
}

export interface OAuthChipConnection {
  providerId: string
  /** Present when the URL re-authorizes an existing credential in place. */
  reconnectCredentialId?: string
  status: OAuthChatAttemptStatus | null
  /** True when the row should read as connected, from any signal. */
  connected: boolean
  /**
   * True only when *this row's* attempt completed AND the credential it was
   * supposed to produce is actually present (a reconnect, which produces no
   * new credential, is exempt). Workspace-wide observation cannot be
   * attributed to one row, so this — not {@link connected} — is what may lock
   * the control, and it is deliberately stricter than the label so a connect
   * that reported success without landing stays retryable.
   */
  connectedFromAttempt: boolean
  /** The workspace already holds a credential this row would connect. */
  hasExistingCredential: boolean
  /** The credential list has loaded, so a click can capture a real baseline. */
  isReady: boolean
  onConnectClick: (event: React.MouseEvent<HTMLAnchorElement>) => void
}

/**
 * Tracks whether the credential a chat credential chip offers is connected.
 *
 * Connection is never inferred from a credential merely existing — the row
 * records an *attempt* when clicked, capturing a baseline of the credentials
 * that already matched, and the OAuth return verifies against that baseline.
 * The attempt is keyed by workspace, provider, reconnect target, and
 * `controlId`, so it survives a reload and cannot be claimed by a sibling row
 * for the same provider.
 */
export function useOAuthChipConnection({
  connectUrl,
  provider,
  displayName,
  controlId,
  onConnected,
}: UseOAuthChipConnectionParams): OAuthChipConnection {
  const { workspaceId } = useParams<{ workspaceId: string }>()

  // A connect URL carrying a credentialId re-authorizes that existing
  // credential in place (reconnect) rather than creating a new one.
  const { providerId, reconnectCredentialId } = useMemo(
    () => resolveOAuthChipTarget(connectUrl, provider),
    [connectUrl, provider]
  )

  const baseProviderId = parseProvider(providerId as OAuthProvider).baseProvider
  const {
    data: workspaceOAuthCredentials = [],
    isFetched,
    refetch: refetchWorkspaceOAuthCredentials,
  } = useWorkspaceCredentials({
    workspaceId,
    type: 'oauth',
    enabled: Boolean(providerId),
  })

  const [activeAttemptId, setActiveAttemptId] = useState<string | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    return new URL(window.location.href).searchParams.get(OAUTH_CHAT_ATTEMPT_PARAM) ?? undefined
  })
  const [connectionStatus, setConnectionStatus] = useState<OAuthChatAttemptStatus | null>(null)
  const [connectedFromWorkspaceChange, setConnectedFromWorkspaceChange] = useState(false)
  const onConnectedRef = useRef(onConnected)
  const oauthWindowWasAwayRef = useRef(false)
  const popupRef = useRef<{ window: Window; attemptId: string } | null>(null)
  /** Attempt this row launched in a popup, outliving the window handle so the success toast survives the watcher clearing it. */
  const launchedAttemptIdRef = useRef<string | null>(null)
  const workspaceCredentialBaselineRef = useRef<{
    scope: string
    baseline: ReturnType<typeof getOAuthCredentialBaseline>
  } | null>(null)

  const credentialTarget = useMemo(
    () => ({
      providerId,
      baseProviderId,
      credentialId: reconnectCredentialId,
      // A credential from an alternate authorization server (Salesforce
      // sandbox) still connects this chip's service; without these the chip
      // reads as disconnected and re-prompts a user who is already connected.
      additionalProviderIds: providerIdsForService(providerId),
    }),
    [baseProviderId, providerId, reconnectCredentialId]
  )
  const credentialScope = `${workspaceId}:${providerId}:${reconnectCredentialId ?? ''}`
  const hasExistingCredential = hasOAuthCredentialForTarget(
    credentialTarget,
    workspaceOAuthCredentials
  )
  const verdictConnected = connectionStatus === 'connected'
  const connected = verdictConnected || connectedFromWorkspaceChange
  // The label trusts the verdict; the lock does not. A swallowed credential-draft
  // failure lets a flow report success with nothing in the workspace, and locking
  // on that would strand the row saying "Connected" with no way to retry. A
  // reconnect produces no new credential, so it has nothing to corroborate against.
  const connectedFromAttempt =
    verdictConnected && (reconnectCredentialId ? true : connectedFromWorkspaceChange)

  useEffect(() => {
    onConnectedRef.current = onConnected
  }, [onConnected])

  /**
   * A credential can appear without this row launching it — the integrations
   * page in another tab, or a desktop flow that never returns through the URL.
   * Diffing the workspace list against this scope's baseline surfaces that.
   *
   * Workspace-wide, so it cannot be attributed to one row: it only ever *shows*
   * the row satisfied. {@link connectedFromAttempt} is what locks it, so a
   * sibling chip for the same provider stays clickable.
   */
  useEffect(() => {
    if (!isFetched) return
    const storedBaseline = workspaceCredentialBaselineRef.current
    if (!storedBaseline || storedBaseline.scope !== credentialScope) {
      workspaceCredentialBaselineRef.current = {
        scope: credentialScope,
        baseline: getOAuthCredentialBaseline(credentialTarget, workspaceOAuthCredentials),
      }
      setConnectedFromWorkspaceChange(false)
      return
    }
    // Workspace-wide observation can reliably identify a newly-added account
    // by id. It cannot prove that an existing credential was reauthorized (an
    // unrelated metadata edit can also update it), so reconnect completion is
    // accepted only from the OAuth return attempt verifier.
    if (reconnectCredentialId) {
      setConnectedFromWorkspaceChange(false)
      return
    }
    // Recomputed rather than latched, so a credential that goes away (deleted,
    // access revoked) takes the row's connected state with it.
    setConnectedFromWorkspaceChange(
      hasOAuthCredentialChanged(
        { ...credentialTarget, ...storedBaseline.baseline },
        workspaceOAuthCredentials
      )
    )
  }, [
    credentialScope,
    credentialTarget,
    isFetched,
    reconnectCredentialId,
    workspaceOAuthCredentials,
  ])

  /**
   * This row's attempt: the one named by the return URL, else the last one
   * stored for this exact row. The stored lookup survives a reload, and covers
   * a transcript rendered after the return hook stripped the URL param. Both
   * are row-scoped, so a sibling chip can never claim this one's result.
   */
  const readRowAttempt = useCallback((): OAuthChatAttempt | null => {
    const active = activeAttemptId ? readOAuthChatAttempt(activeAttemptId) : null
    if (
      active &&
      active.workspaceId === workspaceId &&
      active.providerId === providerId &&
      active.credentialId === reconnectCredentialId &&
      active.controlId === controlId
    ) {
      return active
    }
    return readLatestOAuthChatAttempt({
      workspaceId,
      providerId,
      controlId,
      credentialId: reconnectCredentialId,
    })
  }, [activeAttemptId, controlId, providerId, reconnectCredentialId, workspaceId])

  /**
   * Refetches the workspace credentials and settles this row's pending attempt
   * against them. Shared by the two endings the completion page cannot cover: a
   * return to this tab, and a popup seen closed or parked on a terminal page.
   * Idempotent — an attempt is only rewritten while still `pending`.
   */
  const settleFromCredentials = useCallback(async () => {
    // Identity is captured up front so the verdict below can only land on the
    // attempt this settle was started for. A retry during the refetch installs
    // a replacement, and resolving that one from a run it never triggered would
    // fail a connect whose popup is still going.
    const targetAttemptId = readRowAttempt()?.id
    const result = await refetchWorkspaceOAuthCredentials()
    const credentials = result.data ?? []

    // Also covers a credential connected from another tab, which this row never
    // launched and query state alone would surface only on its next fetch.
    const storedBaseline = workspaceCredentialBaselineRef.current
    if (!reconnectCredentialId && storedBaseline?.scope === credentialScope) {
      setConnectedFromWorkspaceChange(
        hasOAuthCredentialChanged({ ...credentialTarget, ...storedBaseline.baseline }, credentials)
      )
    }

    // Status is re-read after the await: the snapshot above goes stale the
    // moment the popup publishes its verdict mid-refetch, and that stale
    // 'pending' would license the very overwrite this guard exists to prevent.
    const attempt = readRowAttempt()
    if (!attempt || attempt.id !== targetAttemptId || attempt.status !== 'pending') return
    // Only the callback path can prove a reconnect returned — an unrelated edit
    // to the credential is indistinguishable from one here.
    const attemptConnected = reconnectCredentialId
      ? false
      : hasOAuthCredentialChanged(attempt, credentials)
    setOAuthChatAttemptStatus(attempt.id, attemptConnected ? 'connected' : 'failed')
  }, [
    credentialScope,
    credentialTarget,
    readRowAttempt,
    reconnectCredentialId,
    refetchWorkspaceOAuthCredentials,
  ])

  useEffect(() => {
    const syncStatus = () => setConnectionStatus(readRowAttempt()?.status ?? null)
    window.addEventListener(OAUTH_CHAT_ATTEMPT_EVENT, syncStatus)
    window.addEventListener('storage', syncStatus)
    syncStatus()
    return () => {
      window.removeEventListener(OAUTH_CHAT_ATTEMPT_EVENT, syncStatus)
      window.removeEventListener('storage', syncStatus)
    }
  }, [readRowAttempt])

  useEffect(() => {
    const markAway = () => {
      oauthWindowWasAwayRef.current = true
    }
    const verifyAfterReturn = () => {
      if (!oauthWindowWasAwayRef.current || document.visibilityState !== 'visible') return
      // A live popup still owns the flow; settling now would flash "not
      // connected" mid-connect. The away flag deliberately survives this bail —
      // consuming it would spend the only signal a later return has to work
      // with, and no second focus event is guaranteed to arrive.
      if (isPopupStillOpen(popupRef.current)) return
      oauthWindowWasAwayRef.current = false
      void settleFromCredentials()
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markAway()
      else verifyAfterReturn()
    }

    window.addEventListener('blur', markAway)
    window.addEventListener('focus', verifyAfterReturn)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('blur', markAway)
      window.removeEventListener('focus', verifyAfterReturn)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [settleFromCredentials])

  /**
   * Watches a live popup for the endings that publish no verdict. None fire an
   * event here, and the user need never leave this tab for a focus event
   * either, so polling is the only way the row learns the flow is over.
   */
  useEffect(() => {
    if (connectionStatus !== 'pending' || !popupRef.current) return
    const poll = window.setInterval(() => {
      const observation = observePopup(popupRef.current)
      if (observation === 'live') return
      // Stop before settling: the refetch leaves the status `pending` for its
      // duration, so a later tick could resolve an attempt a retry replaced.
      window.clearInterval(poll)
      popupRef.current = null
      // Only `ended` is proof the flow finished with nothing published. A
      // closed-or-disowned handle is not — the deadline below bounds that.
      if (observation === 'ended') void settleFromCredentials()
    }, OAUTH_POPUP_POLL_INTERVAL_MS)
    return () => window.clearInterval(poll)
  }, [connectionStatus, settleFromCredentials])

  /**
   * Backstop for a pending attempt whose outcome never becomes observable.
   * Bounds every pending attempt, not just one this mount launched — the
   * transcript virtualizes, so a row can remount with no window handle at all.
   * Dated from the attempt's `requestedAt`, so a remount inherits the time
   * remaining rather than restarting the clock.
   */
  useEffect(() => {
    if (connectionStatus !== 'pending') return
    const attempt = readRowAttempt()
    if (!attempt) return
    const remaining = Math.max(
      0,
      OAUTH_POPUP_UNOBSERVABLE_TIMEOUT_MS - (Date.now() - attempt.requestedAt)
    )
    let deadline: number
    const settleUnlessPopupOwnsIt = () => {
      // A popup still demonstrably running owns the flow, so the deadline waits
      // rather than expiring: giving up here would spend the bound on a live
      // window that can still die unobservably long afterwards.
      if (isPopupStillOpen(popupRef.current)) {
        deadline = window.setTimeout(settleUnlessPopupOwnsIt, OAUTH_POPUP_POLL_INTERVAL_MS)
        return
      }
      void settleFromCredentials()
    }
    deadline = window.setTimeout(settleUnlessPopupOwnsIt, remaining)
    return () => window.clearTimeout(deadline)
  }, [connectionStatus, readRowAttempt, settleFromCredentials])

  useEffect(() => {
    if (connected) onConnectedRef.current?.()
  }, [connected])

  /**
   * The popup publishes the verdict and closes, showing the user nothing they
   * keep, so the launching tab surfaces the success toast. Failure
   * deliberately stays a label (the retry text): a focus flip mid-flow can
   * settle 'failed' prematurely while the popup is still open, and a toast on
   * that would read as the flow failing behind the user's back.
   */
  useEffect(() => {
    const launchedAttemptId = launchedAttemptIdRef.current
    if (connectionStatus !== 'connected' || !launchedAttemptId) return
    const attempt = readOAuthChatAttempt(launchedAttemptId)
    launchedAttemptIdRef.current = null
    popupRef.current = null
    // The verdict settles the label, but the lock also waits on the credential
    // being observable. A popup flow never blurs this tab, so nothing else
    // refetches here and the row would read "Connected" yet stay clickable.
    void settleFromCredentials()
    if (attempt?.status === 'connected') {
      toast.success(`${attempt.displayName} connected successfully.`)
    }
  }, [connectionStatus, settleFromCredentials])

  /**
   * Desktop app: OAuth cannot run in an embedded window — not in the app
   * window (better-auth binds the flow's state to the initiating browser's
   * cookies) and not in the Sim browser panel (its partition isn't signed in
   * to Sim, and Google/Microsoft reject embedded user agents outright). So
   * the chip hands the whole flow to the system browser via the connect
   * handoff, carrying the workspace/credential scope from the authorize URL;
   * completion returns through the app's loopback and refreshes credentials.
   */
  const onConnectClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (!connectUrl || !isFetched || connectedFromAttempt) {
        event.preventDefault()
        return
      }
      // A second click would replace both the active attempt and the window
      // handle, orphaning the first flow — its verdict lands on an attempt id
      // the row no longer reads, so a successful connect waits forever. The
      // live window is the flow; surface it instead of starting a rival one.
      const livePopup = popupRef.current
      if (isPopupStillOpen(livePopup)) {
        event.preventDefault()
        try {
          livePopup?.window.focus?.()
        } catch {
          // A COOP-severed handle refuses focus, but still owns the flow.
        }
        return
      }
      const attempt = createOAuthChatAttempt({
        workspaceId,
        providerId,
        baseProviderId,
        additionalProviderIds: credentialTarget.additionalProviderIds,
        displayName,
        controlId,
        credentialId: reconnectCredentialId,
        ...getOAuthCredentialBaseline(credentialTarget, workspaceOAuthCredentials),
      })
      setActiveAttemptId(attempt.id)
      setConnectionStatus('pending')

      const bridge = getDesktopBridge()
      if (bridge?.beginOAuthConnect) {
        event.preventDefault()
        const url = new URL(connectUrl)
        setActiveDesktopOAuthChatAttempt(attempt.id)
        void bridge
          .beginOAuthConnect(providerId, {
            workspaceId: url.searchParams.get('workspaceId') ?? workspaceId,
            credentialId: url.searchParams.get('credentialId') ?? undefined,
            chatAttemptId: attempt.id,
          })
          .then((opened) => {
            if (!opened) {
              clearActiveDesktopOAuthChatAttempt(attempt.id)
              setOAuthChatAttemptStatus(attempt.id, 'failed')
            }
          })
        return
      }

      // Web: run the whole flow in a popup so this tab never navigates — the
      // return leg lands on the self-closing chat-complete page, whose verdict
      // reaches this row over the storage listener. A blocked popup navigates
      // to the same URL instead, so the flow keeps the completion page's
      // server-backed verdict either way; only an authorize URL with no return
      // param to rewrite falls all the way back to the plain tab return.
      const completeUrl = buildOAuthChatCompleteAuthorizeUrl(connectUrl, attempt.id)
      if (completeUrl) {
        // Named per attempt: a card can render several credential rows, and a
        // shared name would let the second click renavigate the first row's
        // live popup, stranding that attempt with no return leg.
        const popup = window.open(
          completeUrl,
          `${OAUTH_POPUP_WINDOW_NAME}-${attempt.id}`,
          OAUTH_POPUP_FEATURES
        )
        if (popup) {
          event.preventDefault()
          popup.focus?.()
          popupRef.current = { window: popup, attemptId: attempt.id }
          launchedAttemptIdRef.current = attempt.id
          return
        }
      }

      event.currentTarget.href =
        completeUrl ?? addOAuthChatAttemptToAuthorizeUrl(connectUrl, attempt.id)
    },
    [
      baseProviderId,
      connectUrl,
      connectedFromAttempt,
      controlId,
      credentialTarget,
      displayName,
      isFetched,
      providerId,
      reconnectCredentialId,
      workspaceId,
      workspaceOAuthCredentials,
    ]
  )

  return {
    providerId,
    reconnectCredentialId,
    status: connectionStatus,
    connected,
    connectedFromAttempt,
    hasExistingCredential,
    isReady: isFetched,
    onConnectClick,
  }
}
