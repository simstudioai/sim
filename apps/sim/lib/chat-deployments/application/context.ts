import type { Principal } from '@sim/auth/principal'
import {
  type ChatDeploymentRow,
  getChatDeploymentWithWorkspace,
} from '@/lib/chat-deployments/queries'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkspaceApplicationContext,
  loadActiveWorkspaceApplicationContext,
} from '@/lib/workspaces/application/workspace-context'

export const CHAT_DEPLOYMENT_NOT_FOUND_MESSAGE = 'Chat deployment not found'

export interface ActiveChatDeploymentApplicationContext extends ActiveWorkspaceApplicationContext {
  chatDeploymentId: string
  chatDeployment: ChatDeploymentRow
}

/**
 * Canonical context for one chat deployment.
 *
 * The workspace is derived from the deployment's workflow, never from the
 * caller, and an `assertedWorkspaceId` that disagrees with the derived one is a
 * not-found rather than a forbidden — the caller must learn nothing about a
 * deployment in a workspace it did not name.
 */
export async function resolveActiveChatDeploymentApplicationContext(input: {
  chatDeploymentId: string
  assertedWorkspaceId?: string
}): Promise<ActiveChatDeploymentApplicationContext> {
  const canonical = await getChatDeploymentWithWorkspace(input.chatDeploymentId)
  if (
    !canonical ||
    (input.assertedWorkspaceId !== undefined && input.assertedWorkspaceId !== canonical.workspaceId)
  ) {
    throw new OrchestrationError('not_found', CHAT_DEPLOYMENT_NOT_FOUND_MESSAGE)
  }

  const workspaceContext = await loadActiveWorkspaceApplicationContext(canonical.workspaceId)
  if (!workspaceContext) {
    throw new OrchestrationError('not_found', CHAT_DEPLOYMENT_NOT_FOUND_MESSAGE)
  }
  return {
    ...workspaceContext,
    chatDeploymentId: canonical.chat.id,
    chatDeployment: canonical.chat,
  }
}

/**
 * Leaves scoped-principal workspace mismatches to canonical authorization so
 * they stay 403s, mirroring {@link assertedWorkflowWorkspaceId}.
 */
export function assertedChatDeploymentWorkspaceId(
  principal: Principal,
  assertedWorkspaceId?: string
): string | undefined {
  if (principal.kind === 'workspace_api_key' || principal.kind === 'delegated') return undefined
  return assertedWorkspaceId
}
