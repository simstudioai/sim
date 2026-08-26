import type { Principal } from '@sim/auth/principal'
import {
  type ChatDeploymentRow,
  getChatDeploymentWithWorkspace,
  getLiveChatDeploymentForWorkflow,
} from '@/lib/chat-deployments/queries'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type ActiveWorkflowApplicationContext,
  resolveActiveWorkflowApplicationContext,
} from '@/lib/workflows/application/context'
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
 * The workspace assertion to compare canonical scope against, or `undefined`
 * when the principal already carries its own.
 *
 * A workspace API key and a delegated principal are scoped at issue time, so
 * their mismatches are left to canonical authorization rather than compared
 * here — and that costs nothing, because both surfaces of this domain conceal
 * `WorkspaceApiKeyScopeAuthorizationError` and
 * `DelegatedWorkspaceAuthorizationError` as the same not-found this function
 * would have produced. Every other principal names its workspace per request,
 * and a mismatch there must not reveal that the deployment exists.
 */
export function assertedChatDeploymentWorkspaceId(
  principal: Principal,
  assertedWorkspaceId?: string
): string | undefined {
  if (principal.kind === 'workspace_api_key' || principal.kind === 'delegated') return undefined
  return assertedWorkspaceId
}

/**
 * Canonical context for the chat singleton of one workflow.
 *
 * The parent is the workflow, so the workspace is derived from it rather than
 * from the deployment — which is what lets `PUT` authorize before any
 * deployment row exists. `chatDeployment` is therefore nullable by design: it is
 * `null` on a create, and every caller that requires one says so itself.
 *
 * A workflow the caller cannot reach is already concealed as a not-found by
 * {@link resolveActiveWorkflowApplicationContext}, so no separate assertion is
 * compared here. That is also why the singleton takes no `workspaceId` query
 * param where the deployment-id-keyed reads do: the path already names a
 * resource whose workspace is canonical, so there is no id-alone authorization
 * to defend against.
 */
export interface WorkflowChatDeploymentApplicationContext extends ActiveWorkflowApplicationContext {
  chatDeployment: ChatDeploymentRow | null
}

export async function resolveWorkflowChatDeploymentApplicationContext(input: {
  workflowId: string
}): Promise<WorkflowChatDeploymentApplicationContext> {
  const workflowContext = await resolveActiveWorkflowApplicationContext({
    workflowId: input.workflowId,
  })
  return {
    ...workflowContext,
    chatDeployment: await getLiveChatDeploymentForWorkflow(workflowContext.workflowId),
  }
}

/** The context's deployment, or the not-found a caller requiring one must answer. */
export function requireWorkflowChatDeployment(
  context: WorkflowChatDeploymentApplicationContext
): ChatDeploymentRow {
  if (!context.chatDeployment) {
    throw new OrchestrationError('not_found', CHAT_DEPLOYMENT_NOT_FOUND_MESSAGE)
  }
  return context.chatDeployment
}
