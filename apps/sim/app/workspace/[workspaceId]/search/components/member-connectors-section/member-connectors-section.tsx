'use client'

import { useMemo } from 'react'
import { Chip } from '@sim/emcn'
import { connectorDisplayName } from '@/lib/sim-search/connectors'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import {
  RESOURCE_LIST_STACK,
  SettingsResourceRow,
} from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import { memberConnectorKeys, type WorkspaceMemberConnector } from '@/hooks/queries/kb/connectors'
import {
  CONNECTABLE_MEMBERSHIPS,
  describeMembership,
  enrollmentActionLabel,
  useMemberEnrollment,
} from '@/hooks/use-member-enrollment'

const SHARED_WITH_YOU_LABEL = 'Shared with you'

interface MemberConnectorsSectionProps {
  workspaceId: string
  /** The per-member connectors to show, already narrowed by the page's search. */
  connectors: WorkspaceMemberConnector[]
}

/**
 * The knowledge bases whose connectors sync per member, and where the viewer
 * stands with each. Connecting here is the same enrollment the knowledge base
 * page offers, so a person can do it from whichever surface they are on.
 */
export function MemberConnectorsSection({ workspaceId, connectors }: MemberConnectorsSectionProps) {
  const connectedConnectorIds = useMemo(
    () =>
      new Set(
        connectors
          .filter((connector) => connector.viewerMembership === 'connected')
          .map((connector) => connector.connectorId)
      ),
    [connectors]
  )
  const membershipQueryKeys = useMemo(() => [memberConnectorKeys.list(workspaceId)], [workspaceId])
  const { connect, isAwaiting, isPending, error } = useMemberEnrollment({
    membershipQueryKeys,
    connectedConnectorIds,
  })

  if (connectors.length === 0) return null

  return (
    <>
      <SettingsSection label={SHARED_WITH_YOU_LABEL}>
        <div className={RESOURCE_LIST_STACK}>
          {connectors.map((connector) => {
            const meta = CONNECTOR_META_REGISTRY[connector.connectorType]
            const name = connectorDisplayName(connector.connectorType)
            const waiting = isAwaiting(connector.connectorId)
            const state =
              describeMembership({
                membership: connector.viewerMembership,
                memberSyncStatus: connector.memberSyncStatus,
                waiting,
                name,
              }) ?? 'Connected.'
            return (
              <SettingsResourceRow
                key={connector.connectorId}
                iconVariant='custom'
                icon={
                  meta ? (
                    <IntegrationTile blockType={connector.connectorType} icon={meta.icon} />
                  ) : undefined
                }
                title={name}
                description={[connector.knowledgeBaseName, connector.sourceDescription, state]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  CONNECTABLE_MEMBERSHIPS.has(connector.viewerMembership) ? (
                    <Chip
                      variant='primary'
                      onClick={() => connect(connector.knowledgeBaseId, connector.connectorId)}
                      disabled={isPending}
                    >
                      {enrollmentActionLabel(connector.viewerMembership, waiting)}
                    </Chip>
                  ) : undefined
                }
              />
            )
          })}
        </div>
      </SettingsSection>
      {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
    </>
  )
}
