'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import {
  addOAuthChatAttemptToAuthorizeUrl,
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
import type { OAuthProvider } from '@/lib/oauth/types'
import { parseProvider } from '@/lib/oauth/utils'
import { useWorkspaceCredentials } from '@/hooks/queries/credentials'

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
   * True only when *this row's* attempt completed. Workspace-wide observation
   * cannot be attributed to one row, so this — not {@link connected} — is what
   * may lock the control.
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
  const reconnectCredentialId = useMemo(() => {
    if (!connectUrl) return undefined
    try {
      return new URL(connectUrl).searchParams.get('credentialId') ?? undefined
    } catch {
      return undefined
    }
  }, [connectUrl])

  const providerId = useMemo(() => {
    if (!connectUrl) return provider ?? ''
    try {
      const url = new URL(connectUrl)
      if (url.pathname === '/api/auth/instagram/authorize') return 'instagram'
      if (url.pathname === '/api/auth/shopify/authorize') return 'shopify'
      if (url.pathname === '/api/auth/trello/authorize') return 'trello'
      return url.searchParams.get('providerId') ?? provider ?? ''
    } catch {
      return provider ?? ''
    }
  }, [connectUrl, provider])

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
  const workspaceCredentialBaselineRef = useRef<{
    scope: string
    baseline: ReturnType<typeof getOAuthCredentialBaseline>
  } | null>(null)

  const credentialTarget = useMemo(
    () => ({ providerId, baseProviderId, credentialId: reconnectCredentialId }),
    [baseProviderId, providerId, reconnectCredentialId]
  )
  const credentialScope = `${workspaceId}:${providerId}:${reconnectCredentialId ?? ''}`
  const hasExistingCredential = hasOAuthCredentialForTarget(
    credentialTarget,
    workspaceOAuthCredentials
  )
  const connectedFromAttempt = connectionStatus === 'connected'
  const connected = connectedFromAttempt || connectedFromWorkspaceChange

  useEffect(() => {
    onConnectedRef.current = onConnected
  }, [onConnected])

  /**
   * A credential for this row can also appear without the row launching it —
   * the integrations page in another tab, or a desktop flow that never comes
   * back through the return URL. Diffing the workspace list against the
   * baseline captured for this scope surfaces that.
   *
   * This signal is workspace-wide, so it cannot be attributed to one row:
   * sibling chips for the same provider all see the same change. It therefore
   * only ever *shows* the row as satisfied — {@link connectedFromAttempt} is
   * what locks it, so a second same-provider row stays clickable.
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
   * This row's attempt: the one named by the return URL when we came back from
   * the provider, else the last one stored for this exact row. The stored
   * lookup is what survives a reload — and what covers the transcript
   * rendering only after the return hook has already stripped the URL param.
   * Both are scoped to the row, so a sibling chip for the same provider can
   * never claim this one's result.
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
    const verifyAfterReturn = async () => {
      if (!oauthWindowWasAwayRef.current || document.visibilityState !== 'visible') return
      oauthWindowWasAwayRef.current = false
      const attempt = readRowAttempt()
      const result = await refetchWorkspaceOAuthCredentials()
      const credentials = result.data ?? []

      // Refetching on every return closes the other-tab gap even when this row
      // did not launch the connection. Query state normally drives the effect
      // above; updating here as well makes the result immediate and deterministic.
      const storedBaseline = workspaceCredentialBaselineRef.current
      if (!reconnectCredentialId && storedBaseline?.scope === credentialScope) {
        setConnectedFromWorkspaceChange(
          hasOAuthCredentialChanged(
            { ...credentialTarget, ...storedBaseline.baseline },
            credentials
          )
        )
      }

      if (!attempt || attempt.status !== 'pending') return
      // A reconnect is verified by the callback path, which has proof that the
      // OAuth flow returned. A plain focus event cannot distinguish it from an
      // unrelated edit to the same credential.
      const attemptConnected = reconnectCredentialId
        ? false
        : hasOAuthCredentialChanged(attempt, credentials)
      setOAuthChatAttemptStatus(attempt.id, attemptConnected ? 'connected' : 'failed')
    }
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') markAway()
      else void verifyAfterReturn()
    }

    window.addEventListener('blur', markAway)
    window.addEventListener('focus', verifyAfterReturn)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('blur', markAway)
      window.removeEventListener('focus', verifyAfterReturn)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    credentialScope,
    credentialTarget,
    readRowAttempt,
    reconnectCredentialId,
    refetchWorkspaceOAuthCredentials,
  ])

  useEffect(() => {
    if (connected) onConnectedRef.current?.()
  }, [connected])

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
      const attempt = createOAuthChatAttempt({
        workspaceId,
        providerId,
        baseProviderId,
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

      event.currentTarget.href = addOAuthChatAttemptToAuthorizeUrl(connectUrl, attempt.id)
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
