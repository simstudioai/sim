import { AuditAction, AuditResourceType } from '@sim/audit'
import { requirePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { organization, organizationSearchIntegration } from '@sim/db/schema'
import { eq, sql } from 'drizzle-orm'
import { isLiveEnterpriseSearchEnabled } from '@/lib/core/config/env-flags'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { CredentialGroupProviderConfigurationError } from '@/lib/credential-groups/provider-adapter'
import { isScopedCredentialGroupsAvailable } from '@/lib/credential-groups/scoped-availability'
import { addOrganizationAccountProvider } from '@/lib/credential-groups/service'
import { defineAuthorizedKnowledgeUseCase } from '@/lib/knowledge/application/authorized-knowledge-use-case'
import { resolveKnowledgeOwnerContext } from '@/lib/knowledge/application/contexts'
import { knowledgeOperations } from '@/lib/knowledge/application/operations'
import { listOrganizationSearchApprovals } from '@/lib/knowledge/search/integration-policy'
import { refuseCapability } from '@/lib/permission-groups/capabilities'
import { isOrganizationCapabilityWithheld } from '@/lib/permission-groups/capability-assertions'
import { SEARCH_SOURCE_TYPES, searchMemberAccountProvider } from '@/lib/sim-search/connectors'
import { NativeSearchError } from '@/lib/sim-search/live/http'
import {
  defaultLiveSearchPolicy,
  LIVE_SEARCH_SERVICE_PROVIDERS,
  type LiveSearchPolicy,
  normalizeLiveSearchPolicy,
} from '@/lib/sim-search/live/policy-schema'
import { livePolicyFor, loadLiveSearchPolicies } from '@/lib/sim-search/live/policy-store'
import { loadLiveServiceSource } from '@/lib/sim-search/live/service-sources'

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
    const policies = isLiveEnterpriseSearchEnabled
      ? await loadLiveSearchPolicies({ organizationId: context.organizationId })
      : undefined
    return SEARCH_SOURCE_TYPES.map(([connectorType]) => ({
      connectorType,
      approved: approvals.get(connectorType) ?? false,
      ...(policies ? { policy: livePolicyFor(policies, connectorType) } : {}),
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
    const source = SEARCH_SOURCE_TYPES.find(([type]) => type === input.connectorType)
    if (!source) {
      throw new OrchestrationError('validation', 'This integration is not supported by Sim Search')
    }
    if (input.policy && !isLiveEnterpriseSearchEnabled)
      throw new OrchestrationError('validation', 'Live search settings are not enabled')
    const memberProvider =
      isLiveEnterpriseSearchEnabled && input.approved
        ? searchMemberAccountProvider(input.connectorType)
        : null
    if (memberProvider) {
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
    let memberAccounts: { groupId: string; changed: boolean } | undefined
    const changed =
      policy || memberProvider
        ? await db.transaction(async (tx) => {
            if (memberProvider)
              memberAccounts = await addOrganizationAccountProvider(
                context.organizationId!,
                requirePrincipalSubjectUserId(principal),
                { provider: memberProvider, label: source[1].name },
                tx
              ).catch((error: unknown) => {
                if (error instanceof CredentialGroupProviderConfigurationError)
                  throw new OrchestrationError('validation', error.message)
                throw error
              })
            if (policy)
              await tx
                .update(organization)
                .set({
                  metadata: sql`jsonb_set(COALESCE(${organization.metadata}::jsonb, '{}'::jsonb), '{liveSearchPolicies}', COALESCE(${organization.metadata}::jsonb->'liveSearchPolicies', '{}'::jsonb) || jsonb_build_object(${input.connectorType}::text, ${JSON.stringify(policy)}::jsonb))::json`,
                })
                .where(eq(organization.id, context.organizationId!))
            return saveApproval(tx)
          })
        : await saveApproval(db)
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
                  description: `Added ${result.connectorType} member sign-in for Sim Search`,
                  metadata: { connectorType: result.connectorType },
                },
              ]
            : []),
        ]
      : [],
})
