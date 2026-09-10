import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { readSearchConnectionCompletion } from '@/lib/credential-groups/search-connection-completion'
import {
  getIntegrationAvailability,
  isOAuthServiceDeploymentAvailable,
} from '@/lib/integrations/availability.server'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { readSearchSourceOverview } from '@/lib/knowledge/application/search-source-overview'
import { listSearchSources } from '@/lib/knowledge/application/search-sources'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { getConnectorAccessAvailability, SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'

export interface ListPersonalSearchIntegrationsInput {
  organizationId: string
  connectorType?: string
  connectorId?: string
  cursor?: string
  completionId?: string
}

/** Current personal connections and eligible setup controls, shared by chat and Integrations. */
export const listPersonalSearchIntegrations = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listPersonalSearchIntegrations,
  resolveContext: ({ input }: { input: ListPersonalSearchIntegrationsInput }) =>
    resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input, context }) {
    const userId = requirePrincipalSubjectUserId(principal)
    const [viewer] = await db
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    if (!viewer) throw new OrchestrationError('forbidden', 'The current person is unavailable')
    const [page, overview, approvals, access] = await Promise.all([
      listSearchSources.execute({ principal, input }),
      readSearchSourceOverview.execute({
        principal,
        input: { organizationId: context.organizationId },
      }),
      listOrganizationSearchApprovals(context.organizationId),
      resolveKnowledgeAccessAvailability(context),
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
    const configured = new Set(overview.providers.map((entry) => entry.connectorType))
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
                  : source.viewerDocumentCount > 0
                    ? ('indexed' as const)
                    : ('not_indexed' as const),
          searchableDocuments: source.viewerDocumentCount,
          action: canConnect && !accounts.length ? target : null,
        },
      ]
    })
    const available: Array<{ name: string; description: string; target: SearchConnectionTarget }> =
      [
        ...projected.flatMap((entry) =>
          entry.action
            ? [{ name: entry.name, description: entry.description, target: entry.action }]
            : []
        ),
        ...SEARCH_CONNECTORS.filter(
          (connector) =>
            !input.connectorId &&
            (!input.connectorType || connector.type === input.connectorType) &&
            connector.type !== 'slack' &&
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
  },
})

/** Revalidates a model- or URL-supplied target against current personal eligibility. */
export const resolvePersonalSearchConnection = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listPersonalSearchIntegrations,
  resolveContext: ({
    input,
  }: {
    input: { organizationId: string; target: SearchConnectionTarget }
  }) => resolveKnowledgeOrganizationContext(input),
  async execute({ principal, input }) {
    const page = await listPersonalSearchIntegrations.execute({
      principal,
      input: {
        organizationId: input.organizationId,
        connectorType: input.target.connectorType,
        connectorId: input.target.connectorId,
      },
    })
    const targets = [
      ...page.available.map((entry) => ({ name: entry.name, target: entry.target })),
      ...page.connections.flatMap((entry) =>
        entry.accounts.flatMap((account) =>
          account.action ? [{ name: entry.name, target: account.action }] : []
        )
      ),
    ]
    const selected = targets.find(
      ({ target }) =>
        target.provider === input.target.provider &&
        target.connectorType === input.target.connectorType &&
        target.connectorId === input.target.connectorId &&
        target.credentialId === input.target.credentialId
    )
    if (!selected)
      throw new OrchestrationError(
        'validation',
        'This connection is no longer available. Refresh your integrations and try again.'
      )
    return selected
  },
})
