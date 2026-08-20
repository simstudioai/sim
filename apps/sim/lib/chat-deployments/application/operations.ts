import { defineWorkspaceOperation } from '@/lib/core/application'

/**
 * Semantic operations on a chat deployment as a resource in its own right.
 *
 * Creation is deliberately absent: deploying a workflow as a chat is
 * `workflows.chat.deploy`, which is keyed on the workflow because that is what
 * the caller names and what gets deployed. Everything below is keyed on the
 * chat deployment, whose workspace is derived by joining its workflow.
 *
 * `chat_deployments.delete` and `workflows.chat.undeploy` are separate for the
 * same reason: one addresses the deployment, the other addresses the workflow
 * whose chat should stop serving. They converge on the same domain effect but a
 * caller of one cannot name the resource the other requires.
 */
const CHAT_DEPLOYMENT_READ_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'workspace_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

/**
 * Writes need an accountable human: a chat deployment controls who may reach a
 * workflow from the open internet, and `public` removes the gate entirely.
 */
const CHAT_DEPLOYMENT_WRITE_POLICY = {
  principalKinds: ['session', 'personal_api_key', 'delegated'],
  delegatedServices: ['copilot'],
} as const

export const chatDeploymentOperations = {
  list: defineWorkspaceOperation({
    id: 'chat_deployments.list',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...CHAT_DEPLOYMENT_READ_POLICY,
  }),
  read: defineWorkspaceOperation({
    id: 'chat_deployments.read',
    minimumRole: 'read',
    workspaceApiKey: 'allow',
    ...CHAT_DEPLOYMENT_READ_POLICY,
  }),
  update: defineWorkspaceOperation({
    id: 'chat_deployments.update',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...CHAT_DEPLOYMENT_WRITE_POLICY,
  }),
  delete: defineWorkspaceOperation({
    id: 'chat_deployments.delete',
    minimumRole: 'admin',
    workspaceApiKey: 'deny',
    ...CHAT_DEPLOYMENT_WRITE_POLICY,
  }),
} as const

export type ChatDeploymentOperation =
  (typeof chatDeploymentOperations)[keyof typeof chatDeploymentOperations]
