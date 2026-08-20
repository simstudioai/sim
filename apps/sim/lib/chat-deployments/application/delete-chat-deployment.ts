import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalAttribution } from '@sim/auth/principal'
import {
  assertedChatDeploymentWorkspaceId,
  resolveActiveChatDeploymentApplicationContext,
} from '@/lib/chat-deployments/application/context'
import { chatDeploymentOperations } from '@/lib/chat-deployments/application/operations'
import { toChatDeploymentView } from '@/lib/chat-deployments/application/read-chat-deployments'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { performChatUndeploy } from '@/lib/workflows/orchestration'

export interface DeleteChatDeploymentInput {
  chatDeploymentId: string
  assertedWorkspaceId?: string
}

/**
 * Stops one chat deployment serving.
 *
 * Keyed on the deployment rather than on its workflow, which is what
 * `workflows.chat.undeploy` takes. Both end in `performChatUndeploy`; they stay
 * separate operations because a caller holding a deployment id cannot name the
 * workflow the other requires, and the reverse.
 *
 * The workflow's own deployment is untouched — only the chat surface stops.
 */
export const deleteChatDeployment = defineAuthorizedWorkspaceUseCase({
  operation: chatDeploymentOperations.delete,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: DeleteChatDeploymentInput
  }) =>
    resolveActiveChatDeploymentApplicationContext({
      chatDeploymentId: input.chatDeploymentId,
      assertedWorkspaceId: assertedChatDeploymentWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  authorizationOptions: {},
  async execute({ principal, context }) {
    const attribution = resolvePrincipalAttribution(principal, {
      workspaceBillingOwnerUserId: context.billedAccountUserId,
    })
    const result = await performChatUndeploy({
      chatId: context.chatDeploymentId,
      userId: attribution.attributedUserId,
      workspaceId: context.workspaceId,
      projectLegacyAudit: false,
    })
    if (!result.success) {
      /**
       * Only a genuinely absent deployment is concealed. `performChatUndeploy`
       * also fails for infrastructure reasons, and rendering one of those as a
       * `404` tells the caller the deployment is gone while it is still serving.
       */
      const message = result.error ?? 'Failed to delete chat deployment'
      if (result.errorCode !== 'not_found') throw new Error(message)
      throw new OrchestrationError('not_found', message)
    }
    return {
      deployment: toChatDeploymentView(context.chatDeployment),
      workspaceId: context.workspaceId,
    }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.CHAT_DELETED,
    resourceType: AuditResourceType.CHAT,
    resourceId: result.deployment.id,
    resourceName: result.deployment.title,
    description: `Deleted chat deployment "${result.deployment.title}"`,
    metadata: {
      workflowId: result.deployment.workflowId,
      identifier: result.deployment.identifier,
      authType: result.deployment.authType,
    },
  }),
})
