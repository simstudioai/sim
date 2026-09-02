'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  type ConnectorData,
  useStartConnectorMemberEnrollment,
} from '@/hooks/queries/kb/connectors'

const logger = createLogger('MemberConnectBanner')

interface MemberConnectBannerProps {
  knowledgeBaseId: string
  connectors: ConnectorData[]
}

/**
 * Asks the viewer to connect their own account for every per-member connector
 * they have not connected yet. Connecting is the one thing a member has to do
 * to see the documents shared with them; everything else happens on its own.
 */
export function MemberConnectBanner({ knowledgeBaseId, connectors }: MemberConnectBannerProps) {
  const { mutate: startEnrollment, isPending } = useStartConnectorMemberEnrollment()
  const [pendingConnectorId, setPendingConnectorId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const awaiting = connectors.filter(
    (connector) =>
      connector.accessMode === 'members' &&
      connector.viewerMembership !== null &&
      connector.viewerMembership !== undefined &&
      connector.viewerMembership !== 'connected'
  )
  if (awaiting.length === 0) return null

  const connect = (connectorId: string) => {
    setError(null)
    setPendingConnectorId(connectorId)
    startEnrollment(
      { knowledgeBaseId, connectorId },
      {
        onSuccess: ({ url }) => {
          window.location.assign(url)
        },
        onError: (err) => {
          logger.error('Failed to start member enrollment', { error: err.message })
          setError(err.message)
          setPendingConnectorId(null)
        },
      }
    )
  }

  return (
    <div className='mx-4 mt-3 flex flex-col gap-2'>
      {awaiting.map((connector) => {
        const name =
          CONNECTOR_META_REGISTRY[connector.connectorType]?.name ?? connector.connectorType
        const reconnect = connector.viewerMembership === 'needs_reauth'
        const busy = isPending && pendingConnectorId === connector.id
        return (
          <div
            key={connector.id}
            className='flex items-center justify-between gap-3 rounded-md border border-[var(--border)] bg-[var(--surface-3)] px-3 py-2'
          >
            <p className='min-w-0 text-[var(--text-body)] text-small'>
              {reconnect
                ? `Reconnect your ${name} account to keep seeing the documents shared with you.`
                : `Connect your ${name} account to see the documents shared with you.`}
            </p>
            <Button
              variant='primary'
              size='sm'
              onClick={() => connect(connector.id)}
              disabled={isPending}
            >
              {busy ? 'Opening…' : reconnect ? 'Reconnect' : 'Connect'}
            </Button>
          </div>
        )
      })}
      {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
    </div>
  )
}
