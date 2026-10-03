import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import {
  credential,
  knowledgeBase,
  knowledgeConnector,
  organization,
  organizationSearchIntegration,
} from '@sim/db/schema'
import { and, eq, exists, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { addOrganizationAccountProvider } from '@/lib/credential-groups/service'
import { SLACK_SEARCH_USER_SCOPES } from '@/lib/credential-groups/slack-managed-user-scopes'
import { resolveKnowledgeAccessAvailability } from '@/lib/knowledge/access/availability'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import {
  listOrganizationSearchApprovals,
  lockOrganizationSearchApproval,
} from '@/lib/knowledge/search/integration-policy'
import { GITHUB_INSTALLATION_PROVIDER_ID } from '@/lib/oauth/github-installation-types'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { isOrganizationCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import {
  addOrganizationSearchMcpProvider,
  prepareSearchMcpProvider,
} from '@/lib/sim-search/live/member-setup'
import {
  defaultLiveSearchPolicy,
  LIVE_SEARCH_SERVICE_PROVIDERS,
  type LiveSearchPolicy,
  normalizeLiveSearchPolicy,
} from '@/lib/sim-search/live/policy-schema'
import { livePolicyFor, loadLiveSearchPolicies } from '@/lib/sim-search/live/policy-store'
import { supportsLiveSearchMode } from '@/lib/sim-search/live/provider-catalog'
import { isSearchProviderEnabled } from '@/lib/sim-search/live/provider-rollout'
import { loadLiveServiceSource } from '@/lib/sim-search/live/service-sources'
import {
  LIVE_SEARCH_SOURCE_TYPES,
  liveSearchMcpConnector,
  liveSearchMemberAccountProvider,
} from '@/lib/sim-search/live/source-catalog'
import { getConnectorMeta } from '@/connectors/registry'

interface SearchIntegrationInput {
  organizationId: string
}
interface ApproveSearchIntegrationInput extends SearchIntegrationInput {
  connectorType: string
  approved: boolean
  policy?: LiveSearchPolicy
}

export const listSearchIntegrations = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.listSearchIntegrations,
  resolveContext: ({ input }: { input: SearchIntegrationInput }) =>
    resolveKnowledgeOwnerContext({ organizationId: input.organizationId }),
  async execute({ context }) {
    if (!context.organizationId)
      throw new OrchestrationError('validation', 'Organization is required')
    const approvals = await listOrganizationSearchApprovals(context.organizationId)
    const policies = await loadLiveSearchPolicies({ organizationId: context.organizationId })
    const scope = { kind: 'organization', organizationId: context.organizationId } as const
    const zoomEnabled = await isSearchProviderEnabled('zoom', scope)
    const integrations = LIVE_SEARCH_SOURCE_TYPES.map(([connectorType]) => ({
      connectorType,
      approved: approvals.get(connectorType) ?? false,
      ...(policies
        ? {
            policy: livePolicyFor(policies, connectorType),
            available: connectorType !== 'zoom' || zoomEnabled,
          }
        : {}),
    }))
    const servicePolicies = integrations.filter(
      (integration) =>
        integration.approved &&
        integration.available !== false &&
        integration.policy?.accessMode === 'service_account' &&
        supportsLiveSearchMode(integration.connectorType, 'service_account')
    )
    const availability = servicePolicies.length
      ? await resolveKnowledgeAccessAvailability(context)
      : null
    const candidates = servicePolicies.filter(
      (integration) =>
        availability?.sourceMirrored &&
        (availability.memberScoped ||
          (integration.connectorType !== 'github' &&
            !getConnectorMeta(integration.connectorType)?.requiresMemberIdentity))
    )
    const configured = candidates.length
      ? await db
          .select({ provider: sql<string>`requested.provider` })
          .from(
            sql`(VALUES ${sql.join(
              candidates.map(
                (integration) =>
                  sql`(${integration.connectorType}::text, ${integration.policy?.sourceId ?? null}::text)`
              ),
              sql`, `
            )}) AS requested(provider, source_id)`
          )
          .where(
            exists(
              db
                .select({ id: knowledgeConnector.id })
                .from(knowledgeConnector)
                .innerJoin(knowledgeBase, eq(knowledgeBase.id, knowledgeConnector.knowledgeBaseId))
                .where(
                  and(
                    eq(knowledgeBase.organizationId, context.organizationId),
                    eq(knowledgeBase.isSearchIndex, true),
                    isNull(knowledgeBase.deletedAt),
                    eq(knowledgeConnector.connectorType, sql`requested.provider`),
                    inArray(knowledgeConnector.status, ['active', 'pending', 'syncing', 'error']),
                    isNull(knowledgeConnector.archivedAt),
                    isNull(knowledgeConnector.deletedAt),
                    or(
                      and(
                        sql`requested.provider = 'github'`,
                        eq(knowledgeConnector.accessMode, 'members'),
                        ne(knowledgeConnector.memberSyncStatus, 'disabled'),
                        sql`jsonb_typeof(${knowledgeConnector.sourceConfig}::jsonb->'githubRepositoryId') = 'string'`,
                        exists(
                          db
                            .select({ id: credential.id })
                            .from(credential)
                            .where(
                              and(
                                eq(credential.id, knowledgeConnector.credentialId),
                                eq(credential.organizationId, context.organizationId),
                                eq(credential.type, 'service_account'),
                                eq(credential.providerId, GITHUB_INSTALLATION_PROVIDER_ID),
                                isNull(credential.revokedAt)
                              )
                            )
                        )
                      ),
                      and(
                        sql`requested.provider <> 'github'`,
                        eq(knowledgeConnector.accessMode, 'admin'),
                        or(
                          and(
                            sql`requested.provider = 'gitlab'`,
                            isNotNull(knowledgeConnector.encryptedApiKey)
                          ),
                          and(
                            sql`requested.provider <> 'gitlab'`,
                            eq(knowledgeConnector.id, sql`requested.source_id`),
                            isNotNull(knowledgeConnector.credentialId)
                          )
                        )
                      )
                    )
                  )
                )
            )
          )
      : []
    const configuredProviders = new Set(configured.map((row) => row.provider))
    return integrations.map((integration) => ({
      ...integration,
      configuredServiceSource: configuredProviders.has(integration.connectorType),
    }))
  },
})

/** Live source approval configures member sign-in without connecting anyone or starting indexing. */
export const approveSearchIntegration = defineAuthorizedKnowledgeUseCase({
  operation: knowledgeOperations.approveSearchIntegration,
  resolveContext: ({ input }: { input: ApproveSearchIntegrationInput }) =>
    resolveKnowledgeOwnerContext({ organizationId: input.organizationId }),
  async execute({ input, context, principal }) {
    if (!context.organizationId)
      throw new OrchestrationError('validation', 'Organization is required')
    const source = LIVE_SEARCH_SOURCE_TYPES.find(([type]) => type === input.connectorType)
    if (!source) {
      throw new OrchestrationError('validation', 'This integration is not supported by Sim Search')
    }
    if (
      input.approved &&
      !(await isSearchProviderEnabled(input.connectorType, {
        kind: 'organization',
        organizationId: context.organizationId,
      }))
    )
      throw new OrchestrationError(
        'forbidden',
        'Zoom Search is not available for this organization'
      )
    const memberProvider = input.approved
      ? input.connectorType === 'slack'
        ? 'slack'
        : liveSearchMemberAccountProvider(input.connectorType)
      : null
    const mcpProvider = input.approved ? liveSearchMcpConnector(input.connectorType) : null
    if (memberProvider || mcpProvider) {
      /** permission-group-enforced: integrations.manage — adding sign-in is part of this explicit source action. */
      if (await isOrganizationCapabilityWithheld(context.organizationId, 'integrations.manage'))
        refuseCapability('integrations.manage')
      if (
        !(await isScopedCredentialGroupsAvailable({
          kind: 'organization',
          organizationId: context.organizationId,
        }))
      )
        throw new OrchestrationError('not_found', 'Connected accounts is not available')
    }
    let policy: LiveSearchPolicy | undefined
    if (input.policy) {
      try {
        policy = normalizeLiveSearchPolicy(input.connectorType, input.policy)
        if (input.connectorType === 'gitlab') {
          if (policy.accessMode === 'member') throw new Error('GitLab requires a service account')
          policy = { ...defaultLiveSearchPolicy('gitlab'), accessMode: 'service_account' }
        } else if (policy.accessMode === 'service_account') {
          if (!LIVE_SEARCH_SERVICE_PROVIDERS.includes(input.connectorType))
            throw new Error('Select a supported service account source')
          policy = {
            ...defaultLiveSearchPolicy(),
            accessMode: 'service_account',
            ...(input.connectorType !== 'github' ? { sourceId: policy.sourceId } : {}),
          }
        } else {
          policy = defaultLiveSearchPolicy()
        }
      } catch {
        throw new OrchestrationError('validation', 'Check the search scope and resource IDs.')
      }
      if (policy.accessMode === 'service_account' && policy.sourceId) {
        try {
          await loadLiveServiceSource(
            { organizationId: context.organizationId },
            input.connectorType,
            policy.sourceId,
            { requireApproved: false }
          )
        } catch (error) {
          if (error instanceof NativeSearchError)
            throw new OrchestrationError('validation', error.message)
          throw error
        }
      }
    }
    const saveApproval = (connection: Pick<typeof db, 'insert'>) =>
      connection
        .insert(organizationSearchIntegration)
        .values({
          organizationId: context.organizationId,
          connectorType: input.connectorType,
          approved: input.approved,
        })
        .onConflictDoUpdate({
          target: [
            organizationSearchIntegration.organizationId,
            organizationSearchIntegration.connectorType,
          ],
          set: { approved: input.approved, updatedAt: new Date() },
          setWhere: sql`${organizationSearchIntegration.approved} IS DISTINCT FROM ${input.approved}`,
        })
        .returning({ connectorType: organizationSearchIntegration.connectorType })
    const mcpSetup = mcpProvider
      ? await prepareSearchMcpProvider(context.organizationId, mcpProvider)
      : null
    let memberAccounts: { groupId: string; changed: boolean } | undefined
    const changed = await db.transaction(async (tx) => {
      await lockOrganizationSearchApproval(tx, context.organizationId!)
      if (memberProvider)
        memberAccounts = await addOrganizationAccountProvider(
          context.organizationId!,
          requirePrincipalSubjectUserId(principal),
          {
            provider: memberProvider,
            label: source[1].name,
            ...(memberProvider === 'slack'
              ? { requiredScopes: [...SLACK_SEARCH_USER_SCOPES] }
              : {}),
          },
          tx
        ).catch((error: unknown) => {
          if (error instanceof CredentialGroupProviderConfigurationError)
            throw new OrchestrationError('validation', error.message)
          throw error
        })
      if (mcpSetup)
        memberAccounts = await addOrganizationSearchMcpProvider(
          context.organizationId!,
          requirePrincipalSubjectUserId(principal),
          mcpSetup,
          tx
        )
      if (policy)
        await tx
          .update(organization)
          .set({
            metadata: sql`jsonb_set(COALESCE(${organization.metadata}::jsonb, '{}'::jsonb), '{liveSearchPolicies}', COALESCE(${organization.metadata}::jsonb->'liveSearchPolicies', '{}'::jsonb) || jsonb_build_object(${input.connectorType}::text, ${JSON.stringify(policy)}::jsonb))::json`,
          })
          .where(eq(organization.id, context.organizationId!))
      return saveApproval(tx)
    })
    return {
      connectorType: input.connectorType,
      approved: input.approved,
      changed: changed.length > 0 || Boolean(policy) || Boolean(memberAccounts?.changed),
      memberAccounts,
      ...(policy ? { policy } : {}),
    }
  },
  projectAudit: ({ context, result }) =>
    result.changed
      ? [
          {
            action: AuditAction.ORGANIZATION_UPDATED,
            resourceType: AuditResourceType.ORGANIZATION,
            resourceId: context.organizationId,
            description: `${result.policy ? 'Updated search scope for' : result.approved ? 'Approved' : 'Deactivated'} ${result.connectorType} for Sim Search`,
            metadata: { connectorType: result.connectorType, approved: result.approved },
          },
          ...(result.memberAccounts?.changed
            ? [
                {
                  action: AuditAction.CREDENTIAL_GROUP_UPDATED,
                  resourceType: AuditResourceType.CREDENTIAL_GROUP,
                  resourceId: result.memberAccounts.groupId,
                  description: `Configured ${result.connectorType} member sign-in for Sim Search`,
                  metadata: { connectorType: result.connectorType },
                },
              ]
            : []),
        ]
      : [],
})
