import { generateId } from '@sim/utils/id'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { buildCopilotRequestPayload } from '@/lib/copilot/chat/payload'
import { generateWorkspaceSnapshot } from '@/lib/copilot/chat/workspace-context'
import { computeWorkspaceEntitlements } from '@/lib/copilot/entitlements'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import type { ExecutionContext, OrchestratorResult, StreamEvent } from '@/lib/copilot/request/types'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { getUserEntityPermissions } from '@/lib/workspaces/permissions/utils'

/** Demo backend pass always uses hosted mothership (never fullstack chatType). */
export const DEMO_MOTHERSHIP_CHAT_TYPE = 'mothership' as const

const DEMO_MODEL = 'claude-opus-4-8'

export type DemoAppProjectContext = {
  id: string
  name: string
  slug: string
  publicId: string
  draftRevisionId: string | null
  publishedReleaseId: string | null
}

async function buildDemoExecutionContext(params: {
  userId: string
  workspaceId: string
  chatId?: string
  messageId: string
  requestMode: 'agent' | 'ask'
  userPermission?: string | null
}): Promise<ExecutionContext> {
  const [decryptedEnvVars, billingAttribution] = await Promise.all([
    getEffectiveDecryptedEnv(params.userId, params.workspaceId),
    resolveBillingAttribution({
      actorUserId: params.userId,
      workspaceId: params.workspaceId,
    }),
  ])
  return {
    userId: params.userId,
    workflowId: '',
    workspaceId: params.workspaceId,
    chatId: params.chatId,
    decryptedEnvVars,
    billingAttribution,
    messageId: params.messageId,
    requestMode: params.requestMode,
    copilotToolExecution: true,
    // Server tools (create_file / edit_workflow) gate on this. Without it the
    // router sees permission 'none' even when the payload carried a real role.
    userPermission: params.userPermission ?? undefined,
  }
}

/**
 * Backend profile: linked Full-stack chat, workspace snapshot/VFS, mothership
 * workflow tools, permissions, entitlements, and App project context.
 */
export async function prepareDemoBackendRequest(params: {
  userId: string
  workspaceId: string
  chatId: string
  message: string
  mode: 'agent' | 'ask'
  appProject?: DemoAppProjectContext
}): Promise<{
  messageId: string
  requestPayload: Record<string, unknown>
  executionContext: ExecutionContext
}> {
  const messageId = generateId()
  const [workspaceSnapshot, userPermission, entitlements] = await Promise.all([
    generateWorkspaceSnapshot(params.workspaceId, params.userId),
    getUserEntityPermissions(params.userId, 'workspace', params.workspaceId),
    computeWorkspaceEntitlements(params.workspaceId, params.userId),
  ])

  const requestPayload = await buildCopilotRequestPayload(
    {
      message: params.message,
      workspaceId: params.workspaceId,
      userId: params.userId,
      userMessageId: messageId,
      mode: params.mode,
      model: DEMO_MODEL,
      chatId: params.chatId,
      workspaceContext: workspaceSnapshot?.markdown,
      vfs: workspaceSnapshot?.snapshot,
      userPermission: userPermission ?? undefined,
      entitlements,
    },
    { selectedModel: DEMO_MODEL }
  )
  requestPayload.chatType = DEMO_MOTHERSHIP_CHAT_TYPE
  if (params.appProject) {
    requestPayload.appProject = params.appProject
  }

  const executionContext = await buildDemoExecutionContext({
    userId: params.userId,
    workspaceId: params.workspaceId,
    chatId: params.chatId,
    messageId,
    requestMode: params.mode,
    userPermission,
  })

  return { messageId, requestPayload, executionContext }
}

/**
 * Frontend profile: stateless + tool-less. No chat history, VFS, appProject,
 * integration tools, or mothership mutation chatType — only the prompt text.
 */
export async function prepareDemoFrontendRequest(params: {
  userId: string
  workspaceId: string
  message: string
}): Promise<{
  messageId: string
  requestPayload: Record<string, unknown>
  executionContext: ExecutionContext
}> {
  const messageId = generateId()
  const userPermission = await getUserEntityPermissions(
    params.userId,
    'workspace',
    params.workspaceId
  )

  // Ask mode skips integration tool schema assembly. Omitting chatId/VFS/
  // chatType keeps this pass isolated from backend conversation state.
  const requestPayload = await buildCopilotRequestPayload(
    {
      message: params.message,
      workspaceId: params.workspaceId,
      userId: params.userId,
      userMessageId: messageId,
      mode: 'ask',
      model: DEMO_MODEL,
      userPermission: userPermission ?? undefined,
    },
    { selectedModel: DEMO_MODEL }
  )
  // Explicitly strip any accidental tool surfaces.
  requestPayload.chatId = undefined
  requestPayload.vfs = undefined
  requestPayload.workspaceContext = undefined
  requestPayload.appProject = undefined
  requestPayload.integrationTools = undefined
  requestPayload.mothershipTools = undefined
  requestPayload.chatType = undefined

  const executionContext = await buildDemoExecutionContext({
    userId: params.userId,
    workspaceId: params.workspaceId,
    messageId,
    requestMode: 'ask',
    userPermission,
  })

  return { messageId, requestPayload, executionContext }
}

/** @deprecated Prefer prepareDemoBackendRequest / prepareDemoFrontendRequest. */
export async function prepareDemoMothershipRequest(params: {
  userId: string
  workspaceId: string
  chatId: string
  message: string
  mode: 'agent' | 'ask'
  appProject?: DemoAppProjectContext
}): Promise<{
  messageId: string
  requestPayload: Record<string, unknown>
  executionContext: ExecutionContext
}> {
  return prepareDemoBackendRequest(params)
}

export async function runDemoMothershipPass(params: {
  userId: string
  workspaceId: string
  chatId: string
  message: string
  mode: 'agent' | 'ask'
  appProject?: DemoAppProjectContext
  abortSignal?: AbortSignal
  onEvent?: (event: StreamEvent) => void | Promise<void>
}): Promise<OrchestratorResult> {
  const { messageId, requestPayload, executionContext } = await prepareDemoBackendRequest(params)
  return runHeadlessCopilotLifecycle(requestPayload, {
    userId: params.userId,
    workspaceId: params.workspaceId,
    chatId: params.chatId,
    goRoute: '/api/mothership',
    // No browser tool executor exists for this server-owned request. This makes
    // client-routed workflow tools use their registered server-side handlers
    // instead of waiting up to an hour for a client completion.
    interactive: false,
    executionContext,
    abortSignal: params.abortSignal,
    simRequestId: messageId,
    onEvent: params.onEvent,
  })
}

export async function runDemoIsolatedAskPass(params: {
  userId: string
  workspaceId: string
  message: string
  abortSignal?: AbortSignal
}): Promise<OrchestratorResult> {
  const { messageId, requestPayload, executionContext } = await prepareDemoFrontendRequest(params)
  return runHeadlessCopilotLifecycle(requestPayload, {
    userId: params.userId,
    workspaceId: params.workspaceId,
    goRoute: '/api/mothership',
    interactive: false,
    executionContext,
    abortSignal: params.abortSignal,
    simRequestId: messageId,
  })
}

export const runDemoFrontendPass = runDemoIsolatedAskPass
