import type { V2ChatContext } from '@/lib/api/contracts/v2/chat'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { buildIntegrationToolSchemas } from '@/lib/copilot/chat/payload'
import { processContextsServer } from '@/lib/copilot/chat/process-contents'
import { generateWorkspaceSnapshot } from '@/lib/copilot/chat/workspace-context'
import { computeWorkspaceEntitlements } from '@/lib/copilot/entitlements'
import {
  createCopilotEnvironmentContext,
  prepareCopilotEnvironmentContext,
} from '@/lib/copilot/environment-context'
import type { MothershipInlineFileAttachment } from '@/lib/copilot/headless/attachments'
import { buildTaggedMcpToolSchemas } from '@/lib/copilot/mcp-tools'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import type { OrchestratorResult, StreamEvent } from '@/lib/copilot/request/types'
import { isDocSandboxEnabled, isHosted } from '@/lib/core/config/env-flags'
import type { EnvironmentResolutionSnapshot } from '@/lib/environment/utils'
import { assertActiveWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

const EMPTY_ENVIRONMENT: EnvironmentResolutionSnapshot = {
  personalEncrypted: {},
  workspaceEncrypted: {},
  personalDecrypted: {},
  workspaceDecrypted: {},
  personalOwners: {},
  conflicts: [],
  decryptionFailures: [],
}

function throwIfWorkspaceChatAborted(
  input: Pick<WorkspaceChatInput, 'abortSignal' | 'userStopSignal'>
) {
  if (!input.abortSignal?.aborted && !input.userStopSignal?.aborted) return
  const error = new Error('Chat request cancelled')
  error.name = 'AbortError'
  throw error
}

export interface WorkspaceChatInput {
  prompt: string
  authorizationUserId: string
  actorUserId: string
  workspaceId: string
  chatId: string
  messageId: string
  requestId: string
  executionId?: string
  runId?: string
  billingAttribution: BillingAttributionSnapshot
  /** Explicit safety mode. Normal Mothership capabilities are the default. */
  readOnly?: boolean
  /** Shared workspace credentials never inherit their creator's personal runtime state. */
  sharedWorkspaceCredential?: boolean
  fileAttachments?: MothershipInlineFileAttachment[]
  /** Identity-bearing `@` resources and `/` skill/MCP tags for this turn. */
  contexts?: V2ChatContext[]
  /** MCP servers explicitly tagged on earlier persisted turns. */
  mcpServerIds?: string[]
  abortSignal?: AbortSignal
  /** Stops local Sim work without cancelling the active Go stream transport. */
  userStopSignal?: AbortSignal
  /** Signals that Go accepted and early-persisted the initial turn. */
  onInitialStreamAccepted?: () => void
  onEvent?: (event: StreamEvent) => void | Promise<void>
  onComplete?: (result: OrchestratorResult) => void | Promise<void>
  onError?: (error: Error, result?: OrchestratorResult) => void | Promise<void>
}

/**
 * Runs the public CLI workspace-chat surface with the normal Mothership
 * capability set, or its explicit query-only projection.
 *
 * The caller has already authenticated and authorized the requested workspace.
 * `authorizationUserId` remains the principal whose current membership governs
 * workspace access. `actorUserId` is deliberately separate: personal keys use
 * that same principal while workspace keys use the workspace billing account as
 * the system actor. Local tool execution is projected back onto the
 * authorization principal while billing remains frozen to `actorUserId`.
 *
 * Query-only is opt-in and gets an empty secret catalog plus the subtractive Go
 * tool policy. Personal credentials in normal mode mirror workspace Mothership.
 * Shared workspace credentials remain fully workspace-authorized but cannot
 * inherit their creator's personal environment, integrations, or memory.
 */
export async function runWorkspaceChat(input: WorkspaceChatInput): Promise<OrchestratorResult> {
  throwIfWorkspaceChatAborted(input)
  const readOnly = input.readOnly === true
  const secretless = readOnly || input.sharedWorkspaceCredential === true
  // MCP execution depends on user-held credentials, which read-only and shared
  // workspace credentials deliberately cannot inherit.
  const contexts = (input.contexts ?? []).filter((context) => !secretless || context.kind !== 'mcp')
  const mcpServerIds = secretless
    ? []
    : Array.from(
        new Set([
          ...(input.mcpServerIds ?? []),
          ...contexts.flatMap((context) => (context.kind === 'mcp' ? [context.serverId] : [])),
        ])
      )

  /**
   * Keep this authorization barrier ahead of every workspace/context read. The
   * route also checks access, but this helper must fail closed on its own.
   */
  const workspaceAccess = await assertActiveWorkspaceAccess(
    input.workspaceId,
    input.authorizationUserId
  )
  throwIfWorkspaceChatAborted(input)
  const [
    workspaceSnapshot,
    entitlements,
    environmentContext,
    integrationTools,
    agentContexts,
    mothershipTools,
  ] = await Promise.all([
    generateWorkspaceSnapshot(input.workspaceId, input.authorizationUserId, {
      workspaceAccess,
      secretless,
    }),
    computeWorkspaceEntitlements(input.workspaceId, input.authorizationUserId),
    secretless
      ? createCopilotEnvironmentContext(
          input.authorizationUserId,
          input.workspaceId,
          EMPTY_ENVIRONMENT
        )
      : prepareCopilotEnvironmentContext(input.authorizationUserId, input.workspaceId),
    secretless
      ? Promise.resolve([])
      : buildIntegrationToolSchemas(
          input.authorizationUserId,
          input.messageId,
          { schemaSurface: 'copilot' },
          input.workspaceId
        ),
    processContextsServer(
      contexts,
      input.authorizationUserId,
      input.prompt,
      input.workspaceId,
      input.chatId
    ),
    secretless
      ? Promise.resolve([])
      : buildTaggedMcpToolSchemas(input.authorizationUserId, input.workspaceId, mcpServerIds),
  ])
  throwIfWorkspaceChatAborted(input)

  if (!workspaceSnapshot) {
    throw new Error('Workspace context is unavailable')
  }
  const userPermission = readOnly ? 'read' : workspaceAccess.permission
  if (!userPermission) {
    // `assertActiveWorkspaceAccess` should make this unreachable, but fail
    // closed if its access/permission invariants ever drift apart.
    throw new Error('Workspace permission is unavailable')
  }

  const requestPayload: Record<string, unknown> = {
    message: input.prompt,
    userId: input.actorUserId,
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    messageId: input.messageId,
    mode: 'agent',
    ...(readOnly ? { queryOnly: true } : {}),
    ...(secretless ? { disableUserMemory: true } : {}),
    ...(input.fileAttachments?.length ? { fileAttachments: input.fileAttachments } : {}),
    ...(agentContexts.length ? { context: agentContexts } : {}),
    workspaceContext: workspaceSnapshot.markdown,
    vfs: workspaceSnapshot.snapshot,
    userPermission,
    ...(entitlements.length > 0 ? { entitlements } : {}),
    ...(integrationTools.length > 0 ? { integrationTools } : {}),
    ...(mothershipTools.length > 0 ? { mothershipTools } : {}),
    ...(isDocSandboxEnabled ? { docCompiler: 'python' } : {}),
    isHosted,
  }

  return runHeadlessCopilotLifecycle(requestPayload, {
    userId: input.actorUserId,
    authorizationUserId: input.authorizationUserId,
    workspaceId: input.workspaceId,
    chatId: input.chatId,
    executionId: input.executionId,
    runId: input.runId,
    // This wrapper owns Sim run creation. Synced calls arrive with route-created
    // ids; Go-only/workspace-key chats intentionally have no Sim parent row.
    autoCreateRunIdentity: false,
    simRequestId: input.requestId,
    // This policy-aware route intentionally fails closed against an older Go
    // task that would ignore queryOnly/disableUserMemory during a mixed deploy.
    goRoute: '/api/mothership/v2-chat',
    resumeRoute: '/api/tools/v2-chat/resume',
    autoExecuteTools: true,
    interactive: false,
    abortSignal: input.abortSignal,
    userStopSignal: input.userStopSignal,
    billingAttribution: input.billingAttribution,
    userPermission,
    ...(secretless
      ? {
          secretActorUserId: null,
          secretMountPolicy: { secretScope: 'selected' as const, mountedSecrets: [] },
        }
      : { secretActorUserId: input.authorizationUserId }),
    environmentContext,
    ...(input.onInitialStreamAccepted
      ? { onInitialStreamAccepted: input.onInitialStreamAccepted }
      : {}),
    onEvent: input.onEvent,
    onComplete: input.onComplete,
    onError: input.onError,
  })
}

export interface PublicChatResult {
  content: string
  continuationToken: string
  usage: {
    prompt?: number
    completion?: number
    total?: number
  }
}

/**
 * The lifecycle turns an upstream 402 into the UI's synthetic usage tag so an
 * interactive browser can render an upgrade card. A public stream has no such
 * renderer; recover the message and expose it as a normal v2 stream error.
 */
export function publicChatUsageLimitMessage(content: string): string | null {
  const match = /^\s*<usage_upgrade>([\s\S]+)<\/usage_upgrade>\s*$/.exec(content)
  if (!match) return null
  try {
    const payload = JSON.parse(match[1]) as { message?: unknown }
    return typeof payload.message === 'string' && payload.message.trim()
      ? payload.message
      : 'Usage limit exceeded'
  } catch {
    return 'Usage limit exceeded'
  }
}

/** Projects the internal result onto the intentionally small public surface. */
export function toPublicChatResult(
  result: OrchestratorResult,
  continuationToken: string
): PublicChatResult {
  return {
    content: result.content,
    continuationToken,
    usage: result.usage
      ? {
          prompt: result.usage.prompt,
          completion: result.usage.completion,
          total: result.usage.prompt + result.usage.completion,
        }
      : {},
  }
}
