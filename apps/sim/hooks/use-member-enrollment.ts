'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { type QueryKey, useQueryClient } from '@tanstack/react-query'
import {
  type ResourceScope,
  resourceScopeFields,
  resourceScopeKey,
} from '@/lib/core/resource-scope'
import {
  CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES,
  credentialGroupOAuthCompletionChannel,
  isCredentialGroupOAuthFailure,
} from '@/lib/credential-groups/oauth-completion'
import type { MemberSyncStatus } from '@/lib/knowledge/types'
import type { SearchConnector } from '@/lib/sim-search/connectors'
import {
  memberConnectorKeys,
  useConnectSimSearchConnector,
  useStartConnectorMemberEnrollment,
  type ViewerConnectorMembership,
  type WorkspaceMemberConnector,
} from '@/hooks/queries/kb/connectors'

const logger = createLogger('MemberEnrollment')

/** How often the membership queries are refreshed while a member connects in another tab. */
const AWAITING_CONNECTION_POLL_MS = 4_000
/** How long a connection is awaited before the surface stops refreshing on its own. */
const AWAITING_CONNECTION_TIMEOUT_MS = 10 * 60_000
const POPUP_BLOCKED_MESSAGE = 'Allow pop-ups for this site to connect your account.'

/** Memberships the viewer can act on themselves. */
export const CONNECTABLE_MEMBERSHIPS: ReadonlySet<ViewerConnectorMembership> = new Set([
  'needs_reauth',
  'invited',
  'not_enrolled',
])

/** The label of the one action a connectable membership offers. */
export function enrollmentActionLabel(
  membership: ViewerConnectorMembership,
  waiting: boolean
): string {
  if (waiting) return 'Open again'
  return membership === 'needs_reauth' ? 'Reconnect' : 'Connect'
}

interface DescribeMembershipInput {
  membership: ViewerConnectorMembership
  memberSyncStatus: MemberSyncStatus
  /** Whether this surface opened an enrollment tab that has not connected yet. */
  waiting: boolean
  /** The connector's display name. */
  name: string
}

/**
 * One sentence on where the viewer stands with a per-member connector, shared
 * by every surface that shows it so the wording cannot drift between them.
 * Null once the viewer is connected and nothing is happening for them.
 */
export function describeMembership({
  membership,
  memberSyncStatus,
  waiting,
  name,
}: DescribeMembershipInput): string | null {
  switch (membership) {
    case 'connected':
      switch (memberSyncStatus) {
        case 'pending':
        case 'running':
          return `Syncing the ${name} documents shared with you. They appear when the sync completes.`
        case 'error':
          return `The last ${name} sync failed; the documents you already have stay visible while it retries.`
        case 'disabled':
          return `Syncing ${name} per member is turned off. Ask a workspace admin to turn it back on.`
        default:
          return null
      }
    case 'needs_reauth':
      return `Reconnect your ${name} account to keep seeing the documents shared with you.`
    case 'unverified_email':
      return `Verify your email address to see the ${name} documents shared with you.`
    case 'revoked':
      return `A workspace admin removed your access to ${name} documents.`
    default:
      return waiting
        ? `Finish connecting your ${name} account in the other tab.`
        : `Connect your ${name} account to see the documents shared with you.`
  }
}

/** An enrollment tab this surface opened that has not connected yet. */
interface AwaitingEnrollment {
  since: number
  tab: Window
  /**
   * The Sim Search source whose connect created the connector, so the source
   * can be told it is awaited before its membership row exists to look it up by.
   */
  connectorType: string | null
  oauthCompletionId?: string
}

interface UseMemberEnrollmentProps {
  /** Queries this surface reads memberships from, refreshed while a connection is awaited. */
  membershipQueryKeys: readonly QueryKey[]
  /** Connector ids the viewer is now connected to; awaiting stops for them. */
  connectedConnectorIds: ReadonlySet<string>
  /** Main Integrations skips the invitation page; invitation-based surfaces keep their flow. */
  directOAuth?: boolean
  onConnectionError?: (message: string) => void
}

/**
 * Lets the viewer connect their own account to a per-member connector, by
 * connector or by Sim Search source. Enrollment opens in a new tab, and the
 * membership queries are polled meanwhile so the surface that started it
 * updates on its own once the account is connected; the workspace-wide
 * membership list is refreshed too, so the other surface catches up as well.
 *
 * The tab is opened in the click itself, before the enrollment link is
 * minted, because a tab opened after a network round trip is outside the
 * click's activation window and popup blockers swallow it.
 */
export function useMemberEnrollment({
  membershipQueryKeys,
  connectedConnectorIds,
  directOAuth = false,
  onConnectionError,
}: UseMemberEnrollmentProps) {
  const connectedRef = useRef(connectedConnectorIds)
  const oauthPopups = useRef(
    new Map<
      string,
      {
        channel: BroadcastChannel
        timer: ReturnType<typeof setTimeout>
        attemptKey: string
        connectorId?: string
      }
    >()
  )
  const queryClient = useQueryClient()
  const enrollment = useStartConnectorMemberEnrollment()
  const sourceConnection = useConnectSimSearchConnector()
  const [awaitingSince, setAwaitingSince] = useState<ReadonlyMap<string, AwaitingEnrollment>>(
    () => new Map()
  )
  const [popupBlocked, setPopupBlocked] = useState(false)
  const [oauthError, setOAuthError] = useState<string | null>(null)

  const refreshMemberships = useCallback(() => {
    for (const queryKey of membershipQueryKeys) {
      void queryClient.invalidateQueries({ queryKey })
    }
    void queryClient.invalidateQueries({ queryKey: memberConnectorKeys.lists() })
  }, [membershipQueryKeys, queryClient])

  const clearOAuth = (completionId: string) => {
    const popup = oauthPopups.current.get(completionId)
    if (!popup) return false
    clearTimeout(popup.timer)
    popup.channel.close()
    oauthPopups.current.delete(completionId)
    setAwaitingSince(
      (current) =>
        new Map([...current].filter(([, entry]) => entry.oauthCompletionId !== completionId))
    )
    return true
  }

  const finishOAuth = (completionId: string, error: string | null) => {
    if (!clearOAuth(completionId)) return
    setOAuthError(error)
    if (error) onConnectionError?.(error)
    refreshMemberships()
  }

  useEffect(() => {
    const popups = oauthPopups.current
    return () => {
      for (const popup of popups.values()) {
        clearTimeout(popup.timer)
        popup.channel.close()
      }
      popups.clear()
    }
  }, [])

  useEffect(() => {
    connectedRef.current = connectedConnectorIds
  }, [connectedConnectorIds])

  /**
   * Polls while any connection is awaited, and once more after the last one
   * connects: that tick drops the connected ids, so a token that later needs
   * reauthorization is not mistaken for a connection still being awaited.
   * Direct OAuth waits for its completion message: provider window isolation
   * can report a closed handle while authorization is still in progress.
   */
  const awaiting = awaitingSince.size > 0
  useEffect(() => {
    if (!awaiting) return
    const timer = setInterval(() => {
      const now = Date.now()
      setAwaitingSince((current) => {
        const next = new Map(
          [...current].filter(
            ([id, { since, tab, oauthCompletionId }]) =>
              (Boolean(oauthCompletionId) || !tab.closed) &&
              (Boolean(oauthCompletionId) || !connectedRef.current.has(id)) &&
              now - since < AWAITING_CONNECTION_TIMEOUT_MS
          )
        )
        return next.size === current.size ? current : next
      })
      refreshMemberships()
    }, AWAITING_CONNECTION_POLL_MS)
    return () => clearInterval(timer)
  }, [awaiting, refreshMemberships])

  /** Opens the tab inside the click, then sends it wherever `start` mints. */
  const openEnrollment = (
    attemptKey: string,
    start: (handlers: {
      oauthCompletionId?: string
      onSuccess: (url: string, connectorId: string, connectorType?: string) => boolean
      onError: () => boolean
    }) => void
  ) => {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      setPopupBlocked(true)
      onConnectionError?.(POPUP_BLOCKED_MESSAGE)
      return
    }
    tab.opener = null
    setPopupBlocked(false)
    setOAuthError(null)
    const oauthCompletionId = directOAuth ? generateId() : undefined
    if (oauthCompletionId) {
      for (const [previousId, previous] of oauthPopups.current) {
        if (
          previous.attemptKey === attemptKey ||
          (previous.connectorId && `connector:${previous.connectorId}` === attemptKey)
        ) {
          clearOAuth(previousId)
        }
      }
      const channel = new BroadcastChannel(credentialGroupOAuthCompletionChannel(oauthCompletionId))
      channel.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (data === 'connected') finishOAuth(oauthCompletionId, null)
        else if (isCredentialGroupOAuthFailure(data))
          finishOAuth(oauthCompletionId, CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES[data])
      }
      const timer = setTimeout(() => {
        finishOAuth(oauthCompletionId, CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES.expired)
      }, AWAITING_CONNECTION_TIMEOUT_MS)
      oauthPopups.current.set(oauthCompletionId, { channel, timer, attemptKey })
    }
    start({
      ...(oauthCompletionId ? { oauthCompletionId } : {}),
      onSuccess: (url, connectorId, connectorType) => {
        if (tab.closed || (oauthCompletionId && !oauthPopups.current.has(oauthCompletionId))) {
          if (oauthCompletionId)
            finishOAuth(oauthCompletionId, CREDENTIAL_GROUP_OAUTH_FAILURE_MESSAGES.denied)
          return false
        }
        if (oauthCompletionId) {
          const popup = oauthPopups.current.get(oauthCompletionId)!
          const connectorAttemptKey = `connector:${connectorId}`
          const latestAttempt = [...oauthPopups.current]
            .reverse()
            .find(
              ([id, entry]) =>
                id === oauthCompletionId ||
                entry.connectorId === connectorId ||
                entry.attemptKey === connectorAttemptKey
            )
          if (latestAttempt?.[0] !== oauthCompletionId) {
            clearOAuth(oauthCompletionId)
            return false
          }
          for (const [previousId, previous] of oauthPopups.current) {
            if (
              previousId === oauthCompletionId ||
              (previous.connectorId !== connectorId && previous.attemptKey !== connectorAttemptKey)
            )
              continue
            clearOAuth(previousId)
          }
          popup.connectorId = connectorId
        }
        tab.location.href = url
        setAwaitingSince((current) =>
          new Map(current).set(connectorId, {
            since: Date.now(),
            tab,
            connectorType: connectorType ?? null,
            ...(oauthCompletionId ? { oauthCompletionId } : {}),
          })
        )
        return true
      },
      onError: () => {
        const active = !oauthCompletionId || oauthPopups.current.has(oauthCompletionId)
        if (oauthCompletionId) finishOAuth(oauthCompletionId, null)
        tab.close()
        return active
      },
    })
  }

  const connect = (knowledgeBaseId: string, connectorId: string) =>
    openEnrollment(`connector:${connectorId}`, ({ onSuccess, onError, oauthCompletionId }) => {
      enrollment.mutate(
        { knowledgeBaseId, connectorId, ...(oauthCompletionId ? { oauthCompletionId } : {}) },
        {
          onSuccess: ({ url }) => onSuccess(url, connectorId),
          onError: (err) => {
            if (!onError()) return
            onConnectionError?.(err.message)
            logger.error('Failed to start member enrollment', { error: err.message })
          },
        }
      )
    })

  /**
   * Connects a Sim Search source: its per-member connector exists afterwards,
   * and the viewer enrolls. The setup fields are read only when this connect
   * creates the connector.
   */
  const connectSource = (
    owner: string | ResourceScope,
    connectorType: string,
    sourceConfig?: Record<string, string>
  ) => {
    const scope =
      typeof owner === 'string' ? { kind: 'workspace' as const, workspaceId: owner } : owner
    const configKey = JSON.stringify(
      Object.entries(sourceConfig ?? {}).sort(([left], [right]) => left.localeCompare(right))
    )
    openEnrollment(
      `source:${resourceScopeKey(scope)}:${connectorType}:${configKey}`,
      ({ onSuccess, onError, oauthCompletionId }) => {
        sourceConnection.mutate(
          {
            ...resourceScopeFields(scope),
            connectorType,
            sourceConfig,
            ...(oauthCompletionId ? { oauthCompletionId } : {}),
          },
          {
            onSuccess: ({ url, connectorId }) => {
              if (onSuccess(url, connectorId, connectorType)) setSetupConnector(null)
            },
            onError: (err) => {
              if (!onError()) return
              onConnectionError?.(err.message)
              logger.error('Failed to connect a Sim Search source', { error: err.message })
            },
          }
        )
      }
    )
  }

  const [setupConnector, setSetupConnector] = useState<SearchConnector | null>(null)

  /**
   * One click on a Sim Search source: enroll in its connector when someone
   * already connected it, ask for its setup fields when it needs them, and
   * otherwise create it and enroll in one step.
   */
  const connectSearchSource = (
    owner: string | ResourceScope,
    connector: SearchConnector,
    connection: WorkspaceMemberConnector | undefined
  ) => {
    if (connection) {
      connect(connection.knowledgeBaseId, connection.connectorId)
      return
    }
    if (connector.setupFields.length > 0) {
      setSetupConnector(connector)
      return
    }
    connectSource(owner, connector.type)
  }

  const isAwaiting = (connectorId: string) =>
    awaitingSince.has(connectorId) &&
    (Boolean(awaitingSince.get(connectorId)?.oauthCompletionId) ||
      !connectedConnectorIds.has(connectorId))

  /**
   * Whether a Sim Search source is awaited by the connect that created its
   * connector: the membership list has no row for it until it refetches, so
   * the source cannot be looked up by connector id yet.
   */
  const isAwaitingSource = (connectorType: string) =>
    [...awaitingSince].some(
      ([id, awaiting]) =>
        awaiting.connectorType === connectorType &&
        (Boolean(awaiting.oauthCompletionId) || !connectedConnectorIds.has(id))
    )

  /** The surface reports the latest attempt, whichever path made it. */
  const latest =
    enrollment.submittedAt >= sourceConnection.submittedAt ? enrollment : sourceConnection
  return {
    connect,
    connectSource,
    connectSearchSource,
    setupConnector,
    closeSetup: () => setSetupConnector(null),
    isAwaiting,
    isAwaitingSource,
    isPending: enrollment.isPending || sourceConnection.isPending,
    error: popupBlocked ? POPUP_BLOCKED_MESSAGE : (oauthError ?? latest.error?.message ?? null),
  }
}
