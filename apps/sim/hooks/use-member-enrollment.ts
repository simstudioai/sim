'use client'

import { useEffect, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { type QueryKey, useQueryClient } from '@tanstack/react-query'
import type { MemberSyncStatus } from '@/lib/knowledge/types'
import {
  memberConnectorKeys,
  useStartConnectorMemberEnrollment,
  type ViewerConnectorMembership,
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
      return memberSyncStatus === 'pending' || memberSyncStatus === 'running'
        ? `Syncing the ${name} documents shared with you. They appear when the sync completes.`
        : null
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

interface UseMemberEnrollmentProps {
  /** Queries this surface reads memberships from, refreshed while a connection is awaited. */
  membershipQueryKeys: readonly QueryKey[]
  /** Connector ids the viewer is now connected to; awaiting stops for them. */
  connectedConnectorIds: ReadonlySet<string>
}

/**
 * Lets the viewer connect their own account to a per-member connector.
 * Enrollment opens in a new tab, and the membership queries are polled
 * meanwhile so the surface that started it updates on its own once the
 * account is connected; the workspace-wide membership list is refreshed too,
 * so the other surface catches up as well.
 *
 * The tab is opened in the click itself, before the enrollment link is
 * minted, because a tab opened after a network round trip is outside the
 * click's activation window and popup blockers swallow it.
 */
export function useMemberEnrollment({
  membershipQueryKeys,
  connectedConnectorIds,
}: UseMemberEnrollmentProps) {
  const connectedRef = useRef(connectedConnectorIds)
  const queryClient = useQueryClient()
  const { mutate: startEnrollment, isPending, error } = useStartConnectorMemberEnrollment()
  const [awaitingSince, setAwaitingSince] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [popupBlocked, setPopupBlocked] = useState(false)

  useEffect(() => {
    connectedRef.current = connectedConnectorIds
  }, [connectedConnectorIds])

  const awaiting = [...awaitingSince.keys()].some((id) => !connectedConnectorIds.has(id))
  useEffect(() => {
    if (!awaiting) return
    const timer = setInterval(() => {
      const now = Date.now()
      setAwaitingSince((current) => {
        const next = new Map(
          [...current].filter(
            ([id, since]) =>
              !connectedRef.current.has(id) && now - since < AWAITING_CONNECTION_TIMEOUT_MS
          )
        )
        return next.size === current.size ? current : next
      })
      for (const queryKey of membershipQueryKeys) {
        void queryClient.invalidateQueries({ queryKey })
      }
      void queryClient.invalidateQueries({ queryKey: memberConnectorKeys.lists() })
    }, AWAITING_CONNECTION_POLL_MS)
    return () => clearInterval(timer)
  }, [awaiting, membershipQueryKeys, queryClient])

  const connect = (knowledgeBaseId: string, connectorId: string) => {
    const tab = window.open('about:blank', '_blank')
    if (!tab) {
      setPopupBlocked(true)
      return
    }
    tab.opener = null
    setPopupBlocked(false)
    startEnrollment(
      { knowledgeBaseId, connectorId },
      {
        onSuccess: ({ url }) => {
          tab.location.href = url
          setAwaitingSince((current) => new Map(current).set(connectorId, Date.now()))
        },
        onError: (err) => {
          tab.close()
          logger.error('Failed to start member enrollment', { error: err.message })
        },
      }
    )
  }

  const isAwaiting = (connectorId: string) =>
    awaitingSince.has(connectorId) && !connectedConnectorIds.has(connectorId)

  return {
    connect,
    isAwaiting,
    isPending,
    error: popupBlocked ? POPUP_BLOCKED_MESSAGE : (error?.message ?? null),
  }
}
