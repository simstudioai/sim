import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import { setDeploymentAuthCookie } from '@/lib/core/security/deployment'
import {
  type DeploymentAuthResult,
  validateDeploymentAuth,
} from '@/lib/core/security/deployment-auth'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/**
 * A chat deployed with `authType: 'public'` is invocable by anyone holding the
 * URL, with no authentication — the same unauthenticated exposure as a public
 * workflow API, which is admin-only. Deploying a chat itself only needs
 * `write`, so this gates the exposure rather than the deployment: an editor can
 * ship a password/email/SSO chat, but only an admin can make one public.
 *
 * Only the *transition to* public is gated. Editing an already-public chat, or
 * moving it off public, stays at `write` — neither increases exposure.
 */
export async function canSetPublicChatAuth(userId: string, workspaceId: string): Promise<boolean> {
  const permission = await getUserEntityPermissions(userId, 'workspace', workspaceId)
  return permission === 'admin'
}

export function setChatAuthCookie(
  response: NextResponse,
  chatId: string,
  type: string,
  encryptedPassword?: string | null
): void {
  setDeploymentAuthCookie(response, 'chat', chatId, type, encryptedPassword)
}

/**
 * Check if user has permission to create a chat for a specific workflow
 */
export async function checkWorkflowAccessForChatCreation(
  workflowId: string,
  userId: string
): Promise<{ hasAccess: boolean; workflow?: any }> {
  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId,
    userId,
    action: 'write',
  })

  if (!authorization.workflow) {
    return { hasAccess: false }
  }

  if (authorization.allowed) {
    return { hasAccess: true, workflow: authorization.workflow }
  }

  return { hasAccess: false }
}

/**
 * Check if user has access to view/edit/delete a specific chat
 */
export async function checkChatAccess(
  chatId: string,
  userId: string
): Promise<{ hasAccess: boolean; chat?: any; workspaceId?: string }> {
  const chatData = await db
    .select({
      chat: chat,
      workflowWorkspaceId: workflow.workspaceId,
    })
    .from(chat)
    .innerJoin(workflow, eq(chat.workflowId, workflow.id))
    .where(and(eq(chat.id, chatId), isNull(chat.archivedAt)))
    .limit(1)

  if (chatData.length === 0) {
    return { hasAccess: false }
  }

  const { chat: chatRecord, workflowWorkspaceId } = chatData[0]
  if (!workflowWorkspaceId) {
    return { hasAccess: false }
  }

  const authorization = await authorizeWorkflowByWorkspacePermission({
    workflowId: chatRecord.workflowId,
    userId,
    action: 'write',
  })

  return authorization.allowed
    ? { hasAccess: true, chat: chatRecord, workspaceId: workflowWorkspaceId }
    : { hasAccess: false }
}

/**
 * Validates auth for a deployed chat. Thin wrapper over the shared
 * {@link validateDeploymentAuth} with the `'chat'` cookie/rate-limit namespace.
 */
export async function validateChatAuth(
  requestId: string,
  deployment: any,
  request: NextRequest,
  parsedBody?: any
): Promise<DeploymentAuthResult> {
  return validateDeploymentAuth(requestId, deployment, request, parsedBody, 'chat')
}
