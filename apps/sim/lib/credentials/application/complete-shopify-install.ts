import { AuditAction, AuditResourceType } from '@sim/audit'
import { createLogger } from '@sim/logger'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { resolveCredentialConnectionTarget } from '@/lib/credentials/application/connection-target'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { resumeConnectorsAfterCredentialReconnect } from '@/lib/knowledge/connectors/credential-recovery'
import { clearOAuthRefreshDeadFlag } from '@/lib/oauth/refresh-coordination'
import { claimShopifyInstall } from '@/lib/oauth/shopify-handoff'
import { getShopifyRefreshScope } from '@/lib/oauth/shopify-installation'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

const logger = createLogger('CompleteShopifyInstall')

export interface CompleteShopifyInstallInput {
  attemptId: string
  browserProof: string
  workspaceId: string
  displayName?: string
}

/** Claims a Shopify-authorized installation using the signed-in person's current workspace authority. */
export const completeShopifyInstall = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.completeConnection,
  resolveContext: ({ input }: { input: CompleteShopifyInstallInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  execute: async ({ principal, input, context }) => {
    await resolveCredentialConnectionTarget({ principal, context, providerId: 'shopify' })
    return claimShopifyInstall({
      ...input,
      userId: principal.userId,
      workspaceId: context.workspaceId,
    })
  },
  projectAudit: ({ result }) =>
    result.changed
      ? [
          {
            action: result.created
              ? AuditAction.CREDENTIAL_CREATED
              : AuditAction.CREDENTIAL_RECONNECTED,
            resourceType: AuditResourceType.CREDENTIAL,
            resourceId: result.credentialId,
            resourceName: result.displayName,
            metadata: { providerId: 'shopify', accountId: result.accountId },
          },
        ]
      : [],
  afterSuccess: async ({ result }) => {
    if (!result.changed) return
    try {
      await clearOAuthRefreshDeadFlag(getShopifyRefreshScope(result.shopDomain))
      await resumeConnectorsAfterCredentialReconnect(result.accountId, new Date())
    } catch {
      logger.warn('Shopify credential saved; connection recovery notification unavailable')
    }
  },
})
