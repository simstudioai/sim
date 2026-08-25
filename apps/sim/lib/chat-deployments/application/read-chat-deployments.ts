import type { Principal } from '@sim/auth/principal'
import {
  assertedChatDeploymentWorkspaceId,
  resolveActiveChatDeploymentApplicationContext,
} from '@/lib/chat-deployments/application/context'
import { chatDeploymentOperations } from '@/lib/chat-deployments/application/operations'
import {
  type ChatDeploymentRow,
  type ChatDeploymentSortBy,
  listWorkspaceChatDeployments,
} from '@/lib/chat-deployments/queries'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

/**
 * Chat deployments carry an encrypted password. It is stripped here, once, so
 * no surface can serve it by forgetting to: every read in this domain returns
 * this projection, and `hasPassword` is the only fact about it a caller learns.
 */
export interface ChatDeploymentView extends Omit<ChatDeploymentRow, 'password'> {
  hasPassword: boolean
}

export function toChatDeploymentView(row: ChatDeploymentRow): ChatDeploymentView {
  const { password, ...rest } = row
  return {
    ...rest,
    includeToolCalls: rest.includeToolCalls ?? false,
    hasPassword: Boolean(password),
  }
}

/** A chat can answer only while both it and its workflow deployment are active. */
export function toEffectiveChatDeploymentView(
  row: ChatDeploymentRow,
  isWorkflowDeployed: boolean
): ChatDeploymentView {
  const deployment = toChatDeploymentView(row)
  return { ...deployment, isActive: deployment.isActive && isWorkflowDeployed }
}

export interface ListChatDeploymentsInput {
  workspaceId: string
  workflowId?: string
  isActive?: boolean
  sortBy?: ChatDeploymentSortBy
  sortOrder?: 'asc' | 'desc'
  limit: number
  cursorKeys?: Parameters<typeof listWorkspaceChatDeployments>[0]['cursorKeys']
}

export const listChatDeployments = defineAuthorizedWorkspaceUseCase({
  operation: chatDeploymentOperations.list,
  resolveContext: ({ input }: { input: ListChatDeploymentsInput }) =>
    resolveActiveWorkspaceApplicationContext(input.workspaceId),
  authorizationOptions: {},
  async execute({ input, context }) {
    const page = await listWorkspaceChatDeployments({
      workspaceId: context.workspaceId,
      workflowId: input.workflowId,
      isActive: input.isActive,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
      limit: input.limit,
      cursorKeys: input.cursorKeys,
    })
    return {
      deployments: page.data.map(({ chat, isWorkflowDeployed }) =>
        toEffectiveChatDeploymentView(chat, isWorkflowDeployed)
      ),
      nextCursorKeys: page.nextCursorKeys,
    }
  },
})

export interface ReadChatDeploymentInput {
  chatDeploymentId: string
  assertedWorkspaceId?: string
}

export const readChatDeployment = defineAuthorizedWorkspaceUseCase({
  operation: chatDeploymentOperations.read,
  resolveContext: ({
    principal,
    input,
  }: {
    principal: Principal
    input: ReadChatDeploymentInput
  }) =>
    resolveActiveChatDeploymentApplicationContext({
      chatDeploymentId: input.chatDeploymentId,
      assertedWorkspaceId: assertedChatDeploymentWorkspaceId(principal, input.assertedWorkspaceId),
    }),
  authorizationOptions: {},
  async execute({ context }) {
    return {
      deployment: toChatDeploymentView(context.chatDeployment),
      workspaceId: context.workspaceId,
    }
  },
})
