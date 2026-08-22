import { AuditAction, AuditResourceType } from '@sim/audit'
import { resolvePrincipalAttribution } from '@sim/auth/principal'
import { apiKeyOperations } from '@/lib/api-key/application/operations'
import { performCreateWorkspaceApiKey } from '@/lib/api-key/orchestration'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export interface CreateCopilotWorkspaceApiKeyInput {
  workspaceId: string
  name: string
}

export const createCopilotWorkspaceApiKey = defineAuthorizedWorkspaceUseCase({
  operation: apiKeyOperations.createFromCopilot,
  resolveContext: async ({ input }: { input: CreateCopilotWorkspaceApiKeyInput }) => {
    const context = await loadActiveWorkspaceApplicationContext(input.workspaceId)
    if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
    return context
  },
  authorizationOptions: {
    delegation: {
      audience: 'sim:api-keys',
      isWithinScope: (principal, context) => principal.workspaceId === context.workspaceId,
    },
  },
  async execute({ principal, input, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await performCreateWorkspaceApiKey({
      workspaceId: context.workspaceId,
      userId: attribution.attributedUserId,
      name: input.name,
      source: 'copilot',
      projectLegacyAudit: false,
      captureAnalytics: false,
    })
    if (!result.success || !result.key) {
      if (result.errorCode === 'conflict') {
        throw new OrchestrationError('conflict', result.error ?? 'API key name already exists')
      }
      throw new Error('Failed to create workspace API key')
    }
    return { key: result.key, workspaceId: context.workspaceId }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.API_KEY_CREATED,
    resourceType: AuditResourceType.API_KEY,
    resourceId: result.key.id,
    resourceName: result.key.name,
    description: `Created API key "${result.key.name}"`,
    metadata: { keyName: result.key.name, keyType: 'workspace', source: 'copilot' },
  }),
})
