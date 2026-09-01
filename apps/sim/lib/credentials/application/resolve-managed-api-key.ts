import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import type { WorkspaceDelegationPolicy } from '@/lib/core/application'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
  requireCredentialGroupCredentialAccess,
} from '@/lib/credential-groups/application/authorization'
import { credentialOperations } from '@/lib/credentials/application/operations'
import {
  loadManagedApiKeyCredentialApplicationContext,
  type ManagedApiKeyCredentialApplicationContext,
  type ResolvedManagedApiKey,
  resolveManagedApiKey,
} from '@/lib/credentials/managed-api-key-resolution'

/**
 * Same scope rule as `credentialGroupDelegationPolicy`, restated for this use case's narrower
 * context: the caller's delegation must name the group the credential belongs to.
 */
const managedApiKeyDelegationPolicy = {
  audience: CREDENTIAL_GROUP_DELEGATION_AUDIENCE,
  isWithinScope: (
    principal: Extract<Principal, { kind: 'delegated' }>,
    context: ManagedApiKeyCredentialApplicationContext
  ) => principal.resourceScope?.credentialGroupId === context.credentialGroupId,
} satisfies WorkspaceDelegationPolicy<ManagedApiKeyCredentialApplicationContext>

export interface ResolveManagedApiKeyInput {
  credentialId: string
  /** The group the caller's delegation is scoped to; the credential must belong to it. */
  credentialGroupId: string
}

/**
 * Reads one Credential Group API key for a running workflow.
 *
 * Authorization runs through the same resource policy as managed OAuth
 * (`requireCredentialGroupCredentialAccess`), so the two enrollment kinds share one answer to
 * "may this workflow use this person's credential": the actor may always use their own, and
 * any other enrollment requires an explicit workflow access grant evaluated in deployment
 * mode. Nothing about a key being pasted rather than granted changes that question.
 */
export const resolveManagedApiKeyCredential = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.useManagedApiKey,
  resolveContext: async ({ input }: { input: ResolveManagedApiKeyInput }) => {
    const context = await loadManagedApiKeyCredentialApplicationContext(input.credentialId)
    if (!context) throw new OrchestrationError('not_found', 'Managed credential not found')
    if (context.credentialGroupId !== input.credentialGroupId) {
      throw new OrchestrationError('not_found', 'Managed credential not found')
    }
    return context
  },
  authorizationOptions: { delegation: managedApiKeyDelegationPolicy },
  async authorizeResource({ principal, context, resourcePolicy }) {
    await requireCredentialGroupCredentialAccess(principal, context, resourcePolicy)
  },
  execute: async ({ context }): Promise<ResolvedManagedApiKey> =>
    resolveManagedApiKey({
      credentialId: context.credentialId,
      workspaceId: context.workspaceId,
    }),
  projectAudit({ context }) {
    return {
      action: AuditAction.CREDENTIAL_ACCESSED,
      resourceType: AuditResourceType.CREDENTIAL,
      resourceId: context.credentialId,
      description: 'Accessed managed API key',
      metadata: { credentialType: 'managed_api_key' },
    }
  },
})
