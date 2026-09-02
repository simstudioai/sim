'use client'

import { useMemo } from 'react'
import { Button } from '@sim/emcn'
import { IntegrationSection } from '@/app/workspace/[workspaceId]/integrations/components/integration-section'
import { IntegrationTile } from '@/app/workspace/[workspaceId]/integrations/components/integrations-showcase'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import { CONNECTOR_META_REGISTRY } from '@/connectors/registry'
import {
  memberConnectorKeys,
  useWorkspaceMemberConnectors,
  type ViewerConnectorMembership,
  type WorkspaceMemberConnector,
} from '@/hooks/queries/kb/connectors'
import { useMemberEnrollment } from '@/hooks/use-member-enrollment'

const SHARED_WITH_YOU_LABEL = 'Shared with you'

/** Memberships the viewer can act on themselves. */
const CONNECTABLE: ReadonlySet<ViewerConnectorMembership> = new Set([
  'needs_reauth',
  'invited',
  'not_enrolled',
])

function describe(connector: WorkspaceMemberConnector, waiting: boolean): string {
  switch (connector.viewerMembership) {
    case 'connected':
      return connector.memberSyncStatus === 'pending' || connector.memberSyncStatus === 'running'
        ? `${connector.knowledgeBaseName} · syncing the documents shared with you`
        : `${connector.knowledgeBaseName} · connected`
    case 'needs_reauth':
      return `${connector.knowledgeBaseName} · reconnect to keep seeing the documents shared with you`
    case 'unverified_email':
      return `${connector.knowledgeBaseName} · verify your email address to see the documents shared with you`
    case 'revoked':
      return `${connector.knowledgeBaseName} · a workspace admin removed your access`
    default:
      return waiting
        ? `${connector.knowledgeBaseName} · finish connecting in the other tab`
        : `${connector.knowledgeBaseName} · connect to see the documents shared with you`
  }
}

interface MemberConnectorsSectionProps {
  workspaceId: string
  /** Lower-cased search text; rows whose knowledge base or connector name lacks it are hidden. */
  search: string
}

/**
 * The knowledge bases whose connectors sync per member, and where the viewer
 * stands with each. Connecting here is the same enrollment the knowledge base
 * page offers, so a person can do it from whichever surface they are on.
 */
export function MemberConnectorsSection({ workspaceId, search }: MemberConnectorsSectionProps) {
  const { data: connectors = [] } = useWorkspaceMemberConnectors(workspaceId)
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

  const visible = connectors.filter((connector) => {
    if (!search) return true
    const name = CONNECTOR_META_REGISTRY[connector.connectorType]?.name ?? connector.connectorType
    return [name, connector.knowledgeBaseName].some((text) => text.toLowerCase().includes(search))
  })
  if (visible.length === 0) return null

  return (
    <IntegrationSection label={SHARED_WITH_YOU_LABEL}>
      {visible.map((connector) => {
        const meta = CONNECTOR_META_REGISTRY[connector.connectorType]
        const waiting = isAwaiting(connector.connectorId)
        const connectable = CONNECTABLE.has(connector.viewerMembership)
        return (
          <SettingsResourceRow
            key={connector.connectorId}
            iconVariant='custom'
            icon={
              meta ? (
                <IntegrationTile blockType={connector.connectorType} icon={meta.icon} />
              ) : undefined
            }
            title={meta?.name ?? connector.connectorType}
            description={describe(connector, waiting)}
            trailing={
              connectable ? (
                <Button
                  variant='primary'
                  size='sm'
                  onClick={() => connect(connector.knowledgeBaseId, connector.connectorId)}
                  disabled={isPending}
                >
                  {waiting
                    ? 'Open again'
                    : connector.viewerMembership === 'needs_reauth'
                      ? 'Reconnect'
                      : 'Connect'}
                </Button>
              ) : undefined
            }
          />
        )
      })}
      {error && <p className='text-[var(--text-error)] text-caption'>{error}</p>}
    </IntegrationSection>
  )
}
