import {
  v2DeleteWorkflowChatDeploymentContract,
  v2GetWorkflowChatDeploymentContract,
  v2ReplaceWorkflowChatDeploymentContract,
} from '@/lib/api/contracts/v2/chat-deployments'
import { defineV2JsonRoute, v2ApiKeyAuth, v2RateLimits } from '@/lib/api/server/routes'
import {
  deleteWorkflowChatDeployment,
  readWorkflowChatDeployment,
  replaceWorkflowChatDeployment,
} from '@/lib/chat-deployments/application'
import { chatDeploymentOperations } from '@/lib/chat-deployments/application/operations'
import { generateRequestId } from '@/lib/core/utils/request'
import { chatDeploymentErrorPolicy, toV2ChatDeployment } from '@/app/api/v2/chat-deployments/utils'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

/**
 * The chat a workflow is published as — a singleton of its workflow.
 *
 * Not to be confused with `/api/v2/workflows/{workflowId}/deployment` (singular), which
 * is the workflow's **own** API deployment: its live version, `isPublicApi`, and
 * whether the draft has drifted. That one governs whether the workflow can be
 * executed at all; this one governs one surface it is served on. A workflow can
 * have an API deployment and no chat, and deleting the chat leaves the API
 * deployment live and executable.
 *
 * `deployments/chat` is plural-and-child because it names a member of the set of
 * surfaces a workflow is published on. `deployment` is singular because a
 * workflow has exactly one of those.
 *
 * There is no `POST` and no `PATCH`. A singleton is already uniquely addressed
 * by its parent, so it has no separate create verb: `PUT` is create-or-replace
 * and is the only write, which is what keeps one domain effect from being
 * reachable through two authorization paths.
 */

/**
 * GET — read the workflow's chat.
 *
 * `404` when the workflow publishes no chat, which is also what a workflow the
 * caller cannot reach answers. Carries the visitor gate — `authType`,
 * `hasPassword`, and the `allowedEmails` allow-list — so it requires workspace
 * `admin`, unlike the workspace-wide list. The stored password is never
 * returned; `hasPassword` reports only whether one is set.
 */
export const GET = defineV2JsonRoute({
  contract: v2GetWorkflowChatDeploymentContract,
  auth: v2ApiKeyAuth,
  operation: chatDeploymentOperations.read,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: chatDeploymentErrorPolicy,
  mapInput: ({ params }) => ({ workflowId: params.workflowId }),
  useCase: readWorkflowChatDeployment,
  present: ({ deployment, workspaceId }) => ({
    data: toV2ChatDeployment(deployment, workspaceId),
  }),
})

/**
 * PUT — create the workflow's chat, or replace it wholesale.
 *
 * Replace, not merge: the deployment ends up as exactly what the body describes,
 * so an omitted optional field takes its platform default rather than whatever
 * the previous deployment carried. `password` is therefore required whenever the
 * result is password-gated and rejected otherwise — it is write-only, so a
 * caller cannot read one back to re-send it, and carrying it over implicitly is
 * the one place a replace would quietly stop meaning replace.
 *
 * `customizations` is the documented exception, and it is not this surface's to
 * fix: `performChatDeploy` is shared with the internal editor and the Copilot
 * deploy tool, which both send partial objects and rely on a per-field merge, so
 * an empty `imageUrl` keeps the stored one rather than clearing it. That same
 * shared rebuild keeps only the three keys declared here, so customization keys
 * written by another surface — the editor's `logoUrl` and `headerText` — do not
 * survive a deploy from any surface, this one included. Both behaviors predate
 * this endpoint; changing either changes the editor and Copilot too.
 *
 * This also deploys the workflow, because a chat serves the live version: a
 * drifted draft is republished as part of the call, and a call landing while
 * another deployment attempt is still preparing is a `409` rather than a second
 * admitted version. An identifier another live deployment already holds is the
 * other `409`.
 */
export const PUT = defineV2JsonRoute({
  contract: v2ReplaceWorkflowChatDeploymentContract,
  auth: v2ApiKeyAuth,
  operation: chatDeploymentOperations.replace,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: chatDeploymentErrorPolicy,
  mapInput: ({ params, body }) => ({
    ...body,
    workflowId: params.workflowId,
    requestId: generateRequestId(),
  }),
  useCase: replaceWorkflowChatDeployment,
  present: ({ deployment, workspaceId }) => ({
    data: toV2ChatDeployment(deployment, workspaceId),
  }),
})

/**
 * DELETE — stop serving the workflow's chat.
 *
 * Its URL stops answering and the identifier becomes free again. The workflow's
 * own deployment is untouched and stays executable through the workflow API —
 * to undeploy that, use `/api/v2/workflows/{workflowId}/deployment`.
 */
export const DELETE = defineV2JsonRoute({
  contract: v2DeleteWorkflowChatDeploymentContract,
  auth: v2ApiKeyAuth,
  operation: chatDeploymentOperations.delete,
  rateLimit: v2RateLimits.publicApi,
  errorPolicy: chatDeploymentErrorPolicy,
  mapInput: ({ params }) => ({ workflowId: params.workflowId }),
  useCase: deleteWorkflowChatDeployment,
  present: ({ deployment }) => ({ data: { id: deployment.id, deleted: true as const } }),
})
