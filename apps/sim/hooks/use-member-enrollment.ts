'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { type QueryKey, useQueryClient } from '@tanstack/react-query'
import { useStartConnectorMemberEnrollment } from '@/hooks/queries/kb/connectors'

const logger = createLogger('MemberEnrollment')

/** How often the given queries are refreshed while a member connects in another tab. */
const AWAITING_CONNECTION_POLL_MS = 4_000

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
 */
export function useMemberEnrollment({
  membershipQueryKeys,
  connectedConnectorIds,
}: UseMemberEnrollmentProps) {
  const queryClient = useQueryClient()
  const { mutate: startEnrollment, isPending } = useStartConnectorMemberEnrollment()
  const [awaitingConnectorIds, setAwaitingConnectorIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [error, setError] = useState<string | null>(null)

  const awaiting = [...awaitingConnectorIds].some((id) => !connectedConnectorIds.has(id))
  useEffect(() => {
    if (!awaiting) return
    const timer = setInterval(() => {
      for (const queryKey of membershipQueryKeys) {
        void queryClient.invalidateQueries({ queryKey })
      }
    }, AWAITING_CONNECTION_POLL_MS)
    return () => clearInterval(timer)
  }, [awaiting, membershipQueryKeys, queryClient])

  const connect = useCallback(
    (knowledgeBaseId: string, connectorId: string) => {
      setError(null)
      startEnrollment(
        { knowledgeBaseId, connectorId },
        {
          onSuccess: ({ url }) => {
            window.open(url, '_blank', 'noopener')
            setAwaitingConnectorIds((current) => new Set([...current, connectorId]))
          },
          onError: (err) => {
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
      awaitingConnectorIds.has(connectorId) && !connectedConnectorIds.has(connectorId),
    [awaitingConnectorIds, connectedConnectorIds]
  )

  return { connect, isAwaiting, isPending, error }
}
