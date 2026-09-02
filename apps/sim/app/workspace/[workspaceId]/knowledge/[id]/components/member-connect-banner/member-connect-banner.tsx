'use client'

import { useEffect, useState } from 'react'
import { Button } from '@sim/emcn'
import { Loader } from '@sim/emcn/icons'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  type ConnectorData,
  connectorKeys,
  useStartConnectorMemberEnrollment,
} from '@/hooks/queries/kb/connectors'

const logger = createLogger('MemberConnectBanner')

/** How often the connector list is refreshed while a member connects in another tab. */
const AWAITING_CONNECTION_POLL_MS = 4_000

interface MemberConnectBannerProps {
  knowledgeBaseId: string
  connectors: ConnectorData[]
}

function connectorName(connector: ConnectorData): string {
  return CONNECTOR_META_REGISTRY[connector.connectorType]?.name ?? connector.connectorType
}

/**
 * What the viewer must do for a per-member connector, if anything. Enrollment
 * opens in a new tab — the enrollment page ends by telling the person to close
 * it — and the list is polled meanwhile so the row updates on its own.
 */
export function MemberConnectBanner({ knowledgeBaseId, connectors }: MemberConnectBannerProps) {
  const queryClient = useQueryClient()
  const { mutate: startEnrollment, isPending } = useStartConnectorMemberEnrollment()
  const [awaitingConnectorIds, setAwaitingConnectorIds] = useState<ReadonlySet<string>>(
    () => new Set()
  )
  const [error, setError] = useState<string | null>(null)

  const rows = connectors.filter(
    (connector) =>
      connector.accessMode === 'members' &&
      connector.viewerMembership !== null &&
      (connector.viewerMembership !== 'connected' ||
        connector.memberSyncStatus === 'pending' ||
        connector.memberSyncStatus === 'running')
  )

  const awaiting = rows.some(
    (connector) =>
      awaitingConnectorIds.has(connector.id) && connector.viewerMembership !== 'connected'
  )
  useEffect(() => {
    if (!awaiting) return
    const timer = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: connectorKeys.lists(knowledgeBaseId) })
    }, AWAITING_CONNECTION_POLL_MS)
    return () => clearInterval(timer)
  }, [awaiting, knowledgeBaseId, queryClient])

  if (rows.length === 0) return null

  const connect = (connectorId: string) => {
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
  }

  return (
    <div className='mx-6 mt-3 mb-1 flex flex-col gap-2'>
      {rows.map((connector) => {
        const name = connectorName(connector)
        const membership = connector.viewerMembership
        const waiting = awaitingConnectorIds.has(connector.id) && membership !== 'connected'
        const text =
          membership === 'connected'
            ? `Syncing the ${name} documents shared with you. They appear when the sync completes.`
            : membership === 'needs_reauth'
              ? `Reconnect your ${name} account to keep seeing the documents shared with you.`
              : membership === 'unverified_email'
                ? `Verify your email address to see the ${name} documents shared with you.`
                : membership === 'revoked'
                  ? `A workspace admin removed your access to ${name} documents.`
                  : waiting
                    ? `Finish connecting your ${name} account in the other tab.`
                    : `Connect your ${name} account to see the documents shared with you.`
        const canConnect =
          membership === 'needs_reauth' || membership === 'invited' || membership === 'not_enrolled'
        return (
          <div
            key={connector.id}
            className='flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-3)] px-3 py-2'
          >
            <p className='flex min-w-0 items-center gap-2 text-[var(--text-body)] text-small'>
              {(membership === 'connected' || waiting) && (
                <Loader className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' animate />
              )}
              <span>{text}</span>
            </p>
            {canConnect && (
              <Button
                variant='primary'
                size='sm'
                onClick={() => connect(connector.id)}
                disabled={isPending}
              >
                {waiting ? 'Open again' : membership === 'needs_reauth' ? 'Reconnect' : 'Connect'}
              </Button>
            )}
          </div>
        )
      })}
      {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
    </div>
  )
}
