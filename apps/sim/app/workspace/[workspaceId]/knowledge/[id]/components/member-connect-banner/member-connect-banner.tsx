'use client'

import { useMemo } from 'react'
import { Button } from '@sim/emcn'
import { Loader } from '@sim/emcn/icons'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  type ConnectorData,
  connectorKeys,
  type ViewerConnectorMembership,
} from '@/hooks/queries/kb/connectors'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'

interface MemberConnectBannerProps {
  knowledgeBaseId: string
  connectors: ConnectorData[]
}

function connectorName(connector: ConnectorData): string {
  return CONNECTOR_META_REGISTRY[connector.connectorType]?.name ?? connector.connectorType
}

/** Memberships the viewer can act on themselves. */
const CONNECTABLE: ReadonlySet<ViewerConnectorMembership> = new Set([
  'needs_reauth',
  'invited',
  'not_enrolled',
])

/**
 * What the viewer must do for each per-member connector, if anything, and
 * what is happening for them once they have connected.
 */
export function MemberConnectBanner({ knowledgeBaseId, connectors }: MemberConnectBannerProps) {
  const rows = connectors.filter(
    (connector) =>
      connector.accessMode === 'members' &&
      connector.viewerMembership !== null &&
      (connector.viewerMembership !== 'connected' ||
        connector.memberSyncStatus === 'pending' ||
        connector.memberSyncStatus === 'running')
  )
  const connectedConnectorIds = useMemo(
    () =>
      new Set(
        connectors
          .filter((connector) => connector.viewerMembership === 'connected')
          .map((connector) => connector.id)
      ),
    [connectors]
  )
  const membershipQueryKeys = useMemo(
    () => [connectorKeys.lists(knowledgeBaseId)],
    [knowledgeBaseId]
  )
  const { connect, isAwaiting, isPending, error } = useMemberEnrollment({
    membershipQueryKeys,
    connectedConnectorIds,
  })

  if (rows.length === 0) return null

  return (
    <div className='mx-6 mt-3 mb-1 flex flex-col gap-2'>
      {rows.map((connector) => {
        const name = connectorName(connector)
        const membership = connector.viewerMembership
        const waiting = isAwaiting(connector.id)
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
            {membership && CONNECTABLE.has(membership) && (
              <Button
                variant='primary'
                size='sm'
                onClick={() => connect(knowledgeBaseId, connector.id)}
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
