import { db } from '@sim/db'
import { chat, workflow } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { authorizeWorkflowByWorkspacePermission } from '@sim/platform-authz/workflow'
import { and, eq, isNull } from 'drizzle-orm'
import type { NextRequest, NextResponse } from 'next/server'
import { isWorkspaceApiExecutionEntitled } from '@/lib/billing/core/api-access'
import { getEnv } from '@/lib/core/config/env'
import { isBillingEnabled, isFreeApiDeploymentGateEnabled } from '@/lib/core/config/env-flags'
import { setDeploymentAuthCookie } from '@/lib/core/security/deployment'
import {
  type DeploymentAuthResult,
  validateDeploymentAuth,
} from '@/lib/core/security/deployment-auth'
import { createErrorResponse } from '@/app/api/workflows/utils'

const logger = createLogger('ChatAuthUtils')

export function setChatAuthCookie(
  response: NextResponse,
  chatId: string,
  type: string,
  encryptedPassword?: string | null
): void {
  setDeploymentAuthCookie(response, 'chat', chatId, type, encryptedPassword)
}

/**
 * A first-party origin is the app itself or any `*.sim.ai` host (chat subdomains
 * + apex). Anything else is a third-party embed. Malformed origins are treated
 * as third-party.
 */
function isFirstPartyOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    if (host === 'sim.ai' || host.endsWith('.sim.ai')) return true
    const appUrl = getEnv('NEXT_PUBLIC_APP_URL')
    if (appUrl && host === new URL(appUrl).hostname.toLowerCase()) return true
    return false
  } catch {
    return false
  }
}

/**
 * Gates cross-origin (embedded) chat requests behind a paid plan on hosted.
 * Same-origin / SSR / first-party requests — including the chat page rendered in
 * a third-party iframe, which calls the API from a `*.sim.ai` origin — are never
 * gated. Returns a 403 response to short-circuit the route, or `null` to allow.
 */
export async function assertChatEmbedAllowed(
  request: NextRequest,
  workflowId: string,
  requestId: string
): Promise<NextResponse | null> {
  if (!isBillingEnabled || !isFreeApiDeploymentGateEnabled) return null

  const origin = request.headers.get('origin')
  if (!origin || isFirstPartyOrigin(origin)) return null

  const [wf] = await db
    .select({ workspaceId: workflow.workspaceId })
    .from(workflow)
    .where(and(eq(workflow.id, workflowId), isNull(workflow.archivedAt)))
    .limit(1)

  if (!wf?.workspaceId) {
    logger.warn(
      `[${requestId}] Chat embed blocked: no active workspace for workflow ${workflowId}, origin=${origin}`
    )
    return createErrorResponse('This chat is currently unavailable', 403)
  }

  if (!(await isWorkspaceApiExecutionEntitled(wf.workspaceId))) {
    logger.warn(`[${requestId}] Chat embed blocked: workspace on free plan, origin=${origin}`)
    return createErrorResponse('Embedding this chat on external sites requires a paid plan', 403)
  }

  return null
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
    action: 'admin',
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
    action: 'admin',
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
