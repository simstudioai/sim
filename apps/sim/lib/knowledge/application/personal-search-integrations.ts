import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { credentialGroup, user } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import { loadAssistantIntegrationTools } from '@/lib/assistant-actions/catalog'
import { assistantSearchSourceForProvider } from '@/lib/assistant-actions/providers'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CREDENTIAL_GROUP_ACCOUNTS_PER_PROVIDER_LIMIT } from '@/lib/credential-groups/limits'
import {
  findCredentialGroupProviderFromProviderId,
  getCredentialGroupProviderId,
  getCredentialGroupProviderService,
} from '@/lib/credential-groups/providers'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { readSearchConnectionCompletion } from '@/lib/credential-groups/search-connection-completion'
import { getOrganizationAccountsGroup } from '@/lib/credential-groups/service'
import { listViewerOrganizationAccounts } from '@/lib/credential-groups/viewer-accounts'
import { listCredentialProviderCatalog } from '@/lib/credentials/application/provider-catalog'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOrganizationContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import type { SearchConnectionTarget } from '@/lib/knowledge/search/connection-target'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { SEARCH_CONNECTORS } from '@/lib/sim-search/connectors'
import { listSavedSearchCredentials } from '@/lib/sim-search/live/accounts'
import { LIVE_SEARCH_SCOPE_FIELDS } from '@/lib/sim-search/live/policy-schema'
import {
  LIVE_SEARCH_SOURCE_TYPES,
  liveSearchSavedMemberProvider,
} from '@/lib/sim-search/live/source-catalog'

export interface ListPersonalSearchIntegrationsInput {
  organizationId: string
  connectorType?: string
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
    const scope = { kind: 'organization', organizationId: context.organizationId } as const
    if (!(await isScopedCredentialGroupsAvailable(scope)))
      return { completedCredentialId: null, connections: [], available: [], nextCursor: null }
    const [group, approvals, assistant, providerCatalog] = await Promise.all([
      getOrganizationAccountsGroup(context.organizationId),
      listOrganizationSearchApprovals(context.organizationId),
      loadAssistantIntegrationTools({ organizationId: context.organizationId, userId }),
      listCredentialProviderCatalog(principal, context),
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
      const source = assistantSearchSourceForProvider(getCredentialGroupProviderId(option.provider))
      const connectorType = connector?.type ?? option.provider
      const searchable = connector && LIVE_SEARCH_SCOPE_FIELDS[connector.type]
      const supportsActions = assistant.providers.includes(option.provider)
      if (
        (!searchable && !supportsActions) ||
        (input.connectorType && connectorType !== input.connectorType)
      )
        return []
      const ready = Boolean(
        viewer.emailVerified &&
          group?.status === 'active' &&
          option.status === 'active' &&
          option.configurationStatus === 'ready' &&
          (!source || approvals.get(source))
      )
      const target: SearchConnectionTarget = {
        type: 'link',
        provider: option.provider,
        connectorType,
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
          name: connector?.meta.name ?? getCredentialGroupProviderService(option.provider).name,
          providerId: option.provider,
          connectorType,
          description: searchable ? '' : 'Personal account for Assistant actions',
          accounts: own,
          connectionStatus: !ready
            ? ('unavailable' as const)
            : own.some((account) => account.status === 'reconnect_needed')
              ? ('reconnect_needed' as const)
              : own.length
                ? ('connected' as const)
                : ('not_connected' as const),
          action:
            ready && own.length < CREDENTIAL_GROUP_ACCOUNTS_PER_PROVIDER_LIMIT ? target : null,
        },
      ]
    })
    const saved = await listSavedSearchCredentials(scope, userId)
    const availableSavedProviders = new Set(
      providerCatalog.flatMap((entry) =>
        entry.type === 'service_account' && entry.available ? [entry.providerId] : []
      )
    )
    const savedConnections = LIVE_SEARCH_SOURCE_TYPES.flatMap(([connectorType, meta]) => {
      const providerId = liveSearchSavedMemberProvider(connectorType)
      if (
        (providerId !== 'jama-service-account' && providerId !== 'flow-service-account') ||
        (input.connectorType && input.connectorType !== connectorType)
      )
        return []
      const ready =
        viewer.emailVerified &&
        approvals.get(connectorType) === true &&
        availableSavedProviders.has(providerId)
      const target: SearchConnectionTarget = {
        type: 'link',
        provider: providerId,
        connectorType,
        connectionMode: 'live',
        savedProviderId: providerId,
      }
      const own = saved
        .filter((row) => row.providerId === providerId)
        .map((row) => ({
          credentialId: row.id,
          displayName: row.displayName,
          status: 'connected' as const,
          action: ready ? { ...target, credentialId: row.id } : null,
        }))
      return [
        {
          name: meta.name,
          providerId,
          connectorType,
          description: 'Personal account for live Search',
          accounts: own,
          connectionStatus: ready
            ? own.length
              ? ('connected' as const)
              : ('not_connected' as const)
            : ('unavailable' as const),
          action:
            ready && own.length < CREDENTIAL_GROUP_ACCOUNTS_PER_PROVIDER_LIMIT ? target : null,
        },
      ]
    })
    const allConnections = [...connections, ...savedConnections]
    return {
      completedCredentialId: input.completionId
        ? await readSearchConnectionCompletion({
            organizationId: context.organizationId,
            userId,
            completionId: input.completionId,
          })
        : null,
      connections: allConnections.filter((entry) => entry.accounts.length > 0),
      available: allConnections.flatMap((entry) =>
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
        target.credentialId === input.target.credentialId &&
        target.connectionMode === input.target.connectionMode &&
        target.optionId === input.target.optionId &&
        target.savedProviderId === input.target.savedProviderId
    )
    if (!selected)
      throw new OrchestrationError(
        'validation',
        'This connection is no longer available. Refresh your integrations and try again.'
      )
    return selected
  },
})
