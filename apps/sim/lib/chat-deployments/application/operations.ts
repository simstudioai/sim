import { defineWorkspaceOperation } from '@/lib/core/application'

/**
 * Semantic operations on a chat deployment as a resource in its own right.
 *
 * A workflow carries at most one live chat, so the public surface addresses it
 * as a singleton under its workflow — `/api/v2/workflows/{workflowId}/deployments/chat`
 * — and every operation there is one of these. `read`, `update`, and `delete`
 * are also what the internal editor calls when it addresses the same deployment
 * by its own id; the resource and its policy are the same either way, so the
 * operation is too.
 *
 * `workflows.chat.deploy` and `workflows.chat.undeploy` remain the entry points
 * for the surfaces that name a workflow and ask for it to be published — the
 * internal deploy route and the Copilot tool. They converge on the same domain
 * effect as `replace` and `delete` but authorize a workflow the caller is
 * deploying rather than a chat surface the caller is configuring.
 */
const CHAT_DEPLOYMENT_LIST_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/**
 * Reading one deployment, and every write, needs an accountable human at
 * workspace admin.
 *
 * A chat deployment controls who may reach a workflow from the open internet,
 * and `public` removes the gate entirely — so its detail is gate configuration:
 * `authType`, `hasPassword`, the `allowedEmails` allow-list, and the full
 * customization blob. Admin is also the role the internal editor has always
 * required of this read, and `defineWorkspaceOperation` therefore excludes
 * workspace API keys, which cannot exceed the write ceiling.
 */
const CHAT_DEPLOYMENT_ADMIN_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

export const chatDeploymentOperations = {
  list: defineWorkspaceOperation({
    id: 'chat_deployments.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...CHAT_DEPLOYMENT_LIST_POLICY,
  }),
  replace: defineWorkspaceOperation({
    id: 'chat_deployments.replace',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...CHAT_DEPLOYMENT_ADMIN_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'chat_deployments.read',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...CHAT_DEPLOYMENT_ADMIN_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'chat_deployments.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...CHAT_DEPLOYMENT_ADMIN_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'chat_deployments.delete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...CHAT_DEPLOYMENT_ADMIN_POLICY,
  }),
} as const

export type ChatDeploymentOperation =
  (typeof chatDeploymentOperations)[keyof typeof chatDeploymentOperations]
