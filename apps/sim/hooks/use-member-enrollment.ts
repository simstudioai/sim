'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { type QueryKey, useQueryClient } from '@tanstack/react-query'
import { useStartConnectorMemberEnrollment } from '@/hooks/queries/kb/connectors'

const logger = createLogger('MemberEnrollment')

/** How often the given queries are refreshed while a member connects in another tab. */
const AWAITING_CONNECTION_POLL_MS = 4_000
/** How long a connection is awaited before the surface stops refreshing on its own. */
const AWAITING_CONNECTION_TIMEOUT_MS = 10 * 60_000

interface UseMemberEnrollmentProps {
  /** Queries carrying the viewer's membership, refreshed while a connection is awaited. */
  membershipQueryKeys: readonly QueryKey[]
  /** Connector ids the viewer is now connected to; awaiting stops for them. */
  connectedConnectorIds: ReadonlySet<string>
}

/**
 * Lets the viewer connect their own account to a per-member connector.
 * Enrollment opens in a new tab — the enrollment page ends by telling the
 * person to close it — and the membership queries are polled meanwhile so
 * the surface that started it updates on its own once they are connected.
 *
 * The tab is opened in the click itself, before the enrollment link is
 * minted, because a tab opened after a network round trip is outside the
 * click's activation window and popup blockers swallow it.
 */
export function useMemberEnrollment({
  membershipQueryKeys,
  connectedConnectorIds,
}: UseMemberEnrollmentProps) {
  const queryClient = useQueryClient()
  const { mutate: startEnrollment, isPending } = useStartConnectorMemberEnrollment()
  const [awaitingSince, setAwaitingSince] = useState<ReadonlyMap<string, number>>(() => new Map())
  const [error, setError] = useState<string | null>(null)

  const awaiting = [...awaitingSince.keys()].some((id) => !connectedConnectorIds.has(id))
  useEffect(() => {
    if (!awaiting) return
    const timer = setInterval(() => {
      const now = Date.now()
      setAwaitingSince((current) => {
        const next = new Map(
          [...current].filter(
            ([id, since]) =>
              !connectedConnectorIds.has(id) && now - since < AWAITING_CONNECTION_TIMEOUT_MS
          )
        )
        return next.size === current.size ? current : next
      })
      for (const queryKey of membershipQueryKeys) {
        void queryClient.invalidateQueries({ queryKey })
      }
    }, AWAITING_CONNECTION_POLL_MS)
    return () => clearInterval(timer)
  }, [awaiting, connectedConnectorIds, membershipQueryKeys, queryClient])

  const connect = useCallback(
    (knowledgeBaseId: string, connectorId: string) => {
      setError(null)
      const tab = window.open('about:blank', '_blank')
      if (tab) tab.opener = null
      startEnrollment(
        { knowledgeBaseId, connectorId },
        {
          onSuccess: ({ url }) => {
            if (tab && !tab.closed) {
              tab.location.href = url
            } else {
              window.location.assign(url)
              return
            }
            setAwaitingSince((current) => new Map(current).set(connectorId, Date.now()))
          },
          onError: (err) => {
            tab?.close()
            logger.error('Failed to start member enrollment', { error: err.message })
            setError(err.message)
          },
        }
      )
    },
    [startEnrollment]
  )

  const isAwaiting = useCallback(
    (connectorId: string) =>
      awaitingSince.has(connectorId) && !connectedConnectorIds.has(connectorId),
    [awaitingSince, connectedConnectorIds]
  )

  return { connect, isAwaiting, isPending, error }
}
