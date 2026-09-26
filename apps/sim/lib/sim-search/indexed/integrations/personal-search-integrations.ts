import type { Principal } from '@sim/auth/principal'
import { readSearchConnectionCompletion } from '@/lib/credential-groups/search-connection-completion'
import {
  getIntegrationAvailability,
  isOAuthServiceDeploymentAvailable,
} from '@/lib/integrations/availability.server'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import type { KnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import type { ListPersonalSearchIntegrationsInput } from '@/lib/knowledge/application/personal-search-integrations'
import { listConfiguredSearchProviderTypes } from '@/lib/knowledge/application/search-source-overview'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { getConnectorAccessAvailability, SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { assertIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'
import { findSharedSlackSearchInstallation } from '@/lib/slack-search/shared-app'

/**
 * The indexed arm of `listPersonalSearchIntegrations`: the viewer's accounts on the connectors
 * that crawl the organization search index, with each source's indexing state. The caller has
 * authorized the principal and loaded the viewer; it reaches this only while
 * `isIndexedOrgSearchEnabled()` is on.
 */
export async function listIndexedPersonalSearchIntegrations({
  principal,
  input,
  context,
  userId,
  viewer,
}: {
  principal: Principal
  input: ListPersonalSearchIntegrationsInput
  context: KnowledgeOrganizationContext
  userId: string
  viewer: { emailVerified: boolean }
}) {
  assertIndexedOrgSearchEnabled()
  const [page, configuredTypes, approvals, access, sharedSlack] = await Promise.all([
    listSearchSources.execute({ principal, input }),
    listConfiguredSearchProviderTypes({ organizationId: context.organizationId }),
    listOrganizationSearchApprovals(context.organizationId),
    resolveKnowledgeAccessAvailability(context),
    findSharedSlackSearchInstallation(context.organizationId),
  ])
  const deployment = new Map(
    getIntegrationAvailability().map((entry) => [entry.type.toLowerCase(), entry])
  )
  const oauth = new Map(
    SEARCH_CONNECTORS.map((entry) => [
      entry.providerId,
      isOAuthServiceDeploymentAvailable(entry.providerId),
    ])
  )
  const configured = new Set(configuredTypes)
  const eligible = (connectorType: string) => {
    const connector = SEARCH_CONNECTORS.find((entry) => entry.type === connectorType)
    return Boolean(
      viewer.emailVerified &&
        connector &&
        approvals.get(connectorType) &&
        getConnectorAccessAvailability(connector.meta, deployment, {
          memberAccessAvailable: access.memberScoped,
          mirroredAccessAvailable: access.sourceMirrored,
          oauthServiceAvailability: oauth,
          isIntegrationAvailabilityReady: true,
        }).members
    )
  }
  const projected = page.sources.flatMap((source) => {
    const connector = SEARCH_CONNECTORS.find((entry) => entry.type === source.connectorType)
    if (!connector) return []
    const target: SearchConnectionTarget = {
      type: 'link',
      provider: connector.providerId,
      connectorType: source.connectorType,
      connectorId: source.connectorId,
    }
    const canConnect =
      eligible(source.connectorType) &&
      source.enabled &&
      source.availability === 'available' &&
      source.viewerEmailVerified &&
      source.connectionRequired &&
      source.viewerMembership !== null &&
      !['revoked', 'unverified_email'].includes(source.viewerMembership)
    const accounts = source.viewerAccounts.map((account) => {
      if (!account.status) throw new Error('Personal Search account status is missing')
      return {
        credentialId: account.credentialId,
        displayName: account.displayName,
        status:
          account.status === 'active' ? ('connected' as const) : ('reconnect_needed' as const),
        action:
          canConnect && account.status === 'needs_reauth'
            ? { ...target, credentialId: account.credentialId }
            : null,
      }
    })
    return [
      {
        name: connector.meta.name,
        providerId: connector.providerId,
        connectorType: connector.type,
        connectorId: source.connectorId,
        knowledgeBaseId: source.knowledgeBaseId,
        description: source.sourceDescription,
        accounts,
        connectionStatus: accounts.some((account) => account.status === 'reconnect_needed')
          ? ('reconnect_needed' as const)
          : accounts.length
            ? ('connected' as const)
            : canConnect
              ? ('not_connected' as const)
              : ('unavailable' as const),
        indexingStatus:
          !source.enabled || source.availability !== 'available' || source.approved === false
            ? ('paused' as const)
            : source.isSyncing
              ? ('indexing' as const)
              : source.hasSyncError || source.viewerFailedDocumentCount > 0
                ? ('sync_failed' as const)
                : source.hasViewerDocuments
                  ? ('indexed' as const)
                  : ('not_indexed' as const),
        action: canConnect && !accounts.length ? target : null,
      },
    ]
  })
  const available: Array<{ name: string; description: string; target: SearchConnectionTarget }> = [
    ...projected.flatMap((entry) =>
      entry.action
        ? [{ name: entry.name, description: entry.description, target: entry.action }]
        : []
    ),
    ...SEARCH_CONNECTORS.filter(
      (connector) =>
        !input.connectorId &&
        (!input.connectorType || connector.type === input.connectorType) &&
        (connector.type !== 'slack' || sharedSlack !== null) &&
        (!configured.has(connector.type) || connector.setupFields.length > 0) &&
        eligible(connector.type)
    ).map((connector) => ({
      name: connector.meta.name,
      description: '',
      target: {
        type: 'link' as const,
        provider: connector.providerId,
        connectorType: connector.type,
      },
    })),
  ]
  return {
    completedCredentialId: input.completionId
      ? await readSearchConnectionCompletion({
          organizationId: context.organizationId,
          userId,
          completionId: input.completionId,
        })
      : null,
    connections: projected.filter((entry) => entry.accounts.length > 0),
    available,
    nextCursor: page.nextCursor,
  }
}
