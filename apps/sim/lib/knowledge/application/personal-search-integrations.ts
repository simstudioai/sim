import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { credentialGroup, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { findCredentialGroupProviderFromProviderId } from '@/lib/credential-groups/providers'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { readSearchConnectionCompletion } from '@/lib/credential-groups/search-connection-completion'
import { getOrganizationAccountsGroup } from '@/lib/credential-groups/service'
import { listViewerOrganizationAccounts } from '@/lib/credential-groups/viewer-accounts'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { isIndexedOrgSearchEnabled } from '@/lib/sim-search/indexed/gate'
import { listIndexedPersonalSearchIntegrations } from '@/lib/sim-search/indexed/integrations/personal-search-integrations'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'

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
    if (isIndexedOrgSearchEnabled())
      return listIndexedPersonalSearchIntegrations({ principal, input, context, userId, viewer })
    if (input.connectorId || input.cursor)
      throw new OrchestrationError('validation', 'Refresh your live account connections')
    const scope = { kind: 'organization', organizationId: context.organizationId } as const
    if (!(await isScopedCredentialGroupsAvailable(scope)))
      return { completedCredentialId: null, connections: [], available: [], nextCursor: null }
    const [group, approvals] = await Promise.all([
      getOrganizationAccountsGroup(context.organizationId),
      listOrganizationSearchApprovals(context.organizationId),
    ])
    const accounts = group
      ? await listViewerOrganizationAccounts({
          organizationId: context.organizationId,
          userId,
          matching: eq(credentialGroup.id, group.id),
        })
      : []
    const connections = (group?.options ?? []).flatMap((option) => {
      const connector = SEARCH_CONNECTORS.find(
        (entry) => findCredentialGroupProviderFromProviderId(entry.providerId) === option.provider
      )
      if (
        !connector ||
        !LIVE_SEARCH_SCOPE_FIELDS[connector.type] ||
        (input.connectorType && connector.type !== input.connectorType)
      )
        return []
      const ready = Boolean(
        viewer.emailVerified &&
          group?.status === 'active' &&
          option.status === 'active' &&
          option.configurationStatus === 'ready' &&
          approvals.get(connector.type)
      )
      const target: SearchConnectionTarget = {
        type: 'link',
        provider: option.provider,
        connectorType: connector.type,
        connectionMode: 'live',
        optionId: option.id,
      }
      const own = accounts
        .filter((account) => account.optionId === option.id)
        .map((account) => ({
          credentialId: account.credentialId,
          displayName: account.displayName,
          status:
            account.status === 'active' ? ('connected' as const) : ('reconnect_needed' as const),
          action: ready ? { ...target, credentialId: account.credentialId } : null,
        }))
      return [
        {
          name: connector.meta.name,
          providerId: option.provider,
          connectorType: connector.type,
          connectorId: undefined,
          knowledgeBaseId: undefined,
          indexingStatus: undefined,
          description: '',
          accounts: own,
          connectionStatus: !ready
            ? ('unavailable' as const)
            : own.some((account) => account.status === 'reconnect_needed')
              ? ('reconnect_needed' as const)
              : own.length
                ? ('connected' as const)
                : ('not_connected' as const),
          action: ready ? target : null,
        },
      ]
    })
    return {
      completedCredentialId: input.completionId
        ? await readSearchConnectionCompletion({
            organizationId: context.organizationId,
            userId,
            completionId: input.completionId,
          })
        : null,
      connections: connections.filter((entry) => entry.accounts.length > 0),
      available: connections.flatMap((entry) =>
        entry.action
          ? [{ name: entry.name, description: entry.description, target: entry.action }]
          : []
      ),
      nextCursor: null,
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
        target.credentialId === input.target.credentialId &&
        target.connectionMode === input.target.connectionMode &&
        target.optionId === input.target.optionId
    )
    if (!selected)
      throw new OrchestrationError(
        'validation',
        'This connection is no longer available. Refresh your integrations and try again.'
      )
    return selected
  },
})
