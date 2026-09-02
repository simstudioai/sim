'use client'

import { useMemo } from 'react'
import { Button } from '@sim/emcn'
import { Loader } from '@sim/emcn/icons'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { type ConnectorData, connectorKeys } from '@/hooks/queries/kb/connectors'
import {
  CONNECTABLE_MEMBERSHIPS,
  describeMembership,
  enrollmentActionLabel,
  useMemberEnrollment,
} from '@/hooks/use-member-enrollment'

interface MemberConnectBannerProps {
  knowledgeBaseId: string
  connectors: ConnectorData[]
}

function connectorName(connector: ConnectorData): string {
  return CONNECTOR_META_REGISTRY[connector.connectorType]?.name ?? connector.connectorType
}

/**
 * What the viewer must do for each per-member connector, if anything, and
 * what is happening for them once they have connected.
 */
export function MemberConnectBanner({ knowledgeBaseId, connectors }: MemberConnectBannerProps) {
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

  const rows = connectors.flatMap((connector) => {
    const membership = connector.viewerMembership
    if (connector.accessMode !== 'members' || membership === null) return []
    const waiting = isAwaiting(connector.id)
    const text = describeMembership({
      membership,
      memberSyncStatus: connector.memberSyncStatus,
      waiting,
      name: connectorName(connector),
    })
    return text ? [{ connector, membership, waiting, text }] : []
  })
  if (rows.length === 0) return null

  return (
    <div className='mx-6 mt-3 mb-1 flex flex-col gap-2'>
      {rows.map(({ connector, membership, waiting, text }) => (
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
          {CONNECTABLE_MEMBERSHIPS.has(membership) && (
            <Button
              variant='primary'
              size='sm'
              onClick={() => connect(knowledgeBaseId, connector.id)}
              disabled={isPending}
            >
              {enrollmentActionLabel(membership, waiting)}
            </Button>
          )}
        </div>
      ))}
      {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
    </div>
  )
}
