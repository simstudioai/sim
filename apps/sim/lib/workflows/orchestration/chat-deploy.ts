import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import type { PrincipalActor } from '@sim/auth/principal'
import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { chatDeploymentPasswordSchema } from '@/lib/api/contracts/chats'
import { buildChatDeploymentUrl } from '@/lib/chat-deployments/urls'
import type { OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { checkNeedsRedeployment } from '@/lib/workflows/deployment-status'
import {
  getWorkflowDeploymentSummary,
  performFullDeploy,
} from '@/lib/workflows/orchestration/deploy'

const logger = createLogger('ChatDeployOrchestration')

export interface ChatDeployPayload {
  workflowId: string
  userId: string
  identifier: string
  title: string
  description?: string
  /** Summary of what changed in this deployment version (distinct from the chat-facing `description`). */
  versionDescription?: string
  /** Short name/label for this deployment version. */
  versionName?: string
  customizations?: { primaryColor?: string; welcomeMessage?: string; imageUrl?: string }
  authType?: 'public' | 'password' | 'email' | 'sso'
  password?: string | null
  allowedEmails?: string[]
  outputConfigs?: Array<{ blockId: string; path: string }>
  /** When true, public SSE may expose thinking if the client also opts into agent-events-v1. */
  includeThinking?: boolean
  /** When true, public SSE may expose tool lifecycle if the client opts into agent-events-v1. */
  includeToolCalls?: boolean
  workspaceId?: string | null
  /** Stable identity for the underlying workflow deployment operation. */
  idempotencyKey?: string
  actorId?: string
  actor?: PrincipalActor
  requestId?: string
  captureDeploymentAnalytics?: false
  projectLegacyAudit?: boolean
  captureLegacyTelemetry?: boolean
}

export interface PerformChatDeployResult {
  success: boolean
  chatId?: string
  chatUrl?: string
  deployedAt?: Date | null
  version?: number
  isUpdate?: boolean
  error?: string
  /**
   * How a failure should be classified by its callers.
   *
   * Without it every refusal here reached the wire as a `400`, which told a
   * caller waiting on an in-flight deployment — a genuine `409` — and a caller
   * who tripped an internal invariant that their request was malformed. Mirrors
   * `performFullDeploy`, whose own code is propagated rather than flattened.
   */
  errorCode?: OrchestrationErrorCode
}

/**
 * Deploys a chat: deploys the underlying workflow via `performFullDeploy`,
 * encrypts passwords, creates or updates the chat record, fires telemetry,
 * and records an audit entry. Both the chat API route and the copilot
 * `deploy_as_chat` tool must use this function.
 */
export async function performChatDeploy(
  params: ChatDeployPayload
): Promise<PerformChatDeployResult> {
  const { workflowId, userId, identifier, title, password } = params

  /**
   * Validate the password here rather than only at the HTTP boundary. The
   * copilot `deploy_as_chat` tool reaches this function without going through a
   * route contract, so a whitespace-only or over-long password would otherwise
   * be encrypted and stored — and neither can ever be submitted through the
   * chat login form, permanently locking visitors out of the deployment.
   *
   * `null` is not a password to validate, it is the absence of one, which the
   * declared `password?: string | null` has always allowed. A replace-shaped
   * caller sends it for every mode that owns no password — the default
   * `public`, plus `email` and `sso` — and validating it rejected all three on
   * a well-formed request. The stored value is cleared by `authType` below
   * regardless, so `null` needs no validation of its own.
   */
  if (password !== undefined && password !== null) {
    const validatedPassword = chatDeploymentPasswordSchema.safeParse(password)
    if (!validatedPassword.success) {
      return {
        success: false,
        error: validatedPassword.error.issues[0].message,
        errorCode: 'validation',
      }
    }
  }

  /**
   * Redeploys merge: any field the caller omitted keeps the existing chat's
   * value instead of being reset to a default. Before this, a copilot
   * `deploy_as_chat` call that changed only the title silently flipped an
   * email/sso-protected chat back to public, wiped its allowlist and output
   * configuration, and reset the welcome customizations — the caller had no
   * way to know, because none of those fields were readable back. Defaults
   * apply only when there is no existing deployment to preserve.
   */
  const [existingDeployment] = await db
    .select()
    .from(chat)
    .where(and(eq(chat.workflowId, workflowId), isNull(chat.archivedAt)))
    .limit(1)

  const authType =
    params.authType ??
    (existingDeployment?.authType as ChatDeployPayload['authType'] | undefined) ??
    'public'
  const description =
    params.description !== undefined ? params.description : (existingDeployment?.description ?? '')
  const allowedEmails =
    params.allowedEmails ?? (existingDeployment?.allowedEmails as string[] | null) ?? []
  const outputConfigs =
    params.outputConfigs ??
    (existingDeployment?.outputConfigs as Array<{ blockId: string; path: string }> | null) ??
    []
  const includeThinking = params.includeThinking ?? existingDeployment?.includeThinking ?? false
  const includeToolCalls = params.includeToolCalls ?? existingDeployment?.includeToolCalls ?? false

  // Per-field merge (params over existing over defaults): callers routinely
  // send a customizations object with only some fields set, and a hard default
  // for the rest silently reset the chat's colors and welcome message.
  const existingCustomizations =
    existingDeployment?.customizations &&
    typeof existingDeployment.customizations === 'object' &&
    !Array.isArray(existingDeployment.customizations)
      ? (existingDeployment.customizations as {
          primaryColor?: string
          welcomeMessage?: string
          imageUrl?: string
        })
      : undefined
  const mergedImageUrl = params.customizations?.imageUrl || existingCustomizations?.imageUrl
  const customizations = {
    primaryColor:
      params.customizations?.primaryColor ||
      existingCustomizations?.primaryColor ||
      'var(--brand-hover)',
    welcomeMessage:
      params.customizations?.welcomeMessage ||
      existingCustomizations?.welcomeMessage ||
      'Hi there! How can I help you today?',
    ...(mergedImageUrl ? { imageUrl: mergedImageUrl } : {}),
  }

  /**
   * Refused before anything is deployed.
   *
   * The same condition is re-checked below once the password has been
   * encrypted, but reaching that point costs a real workflow deployment
   * version: a request that can never succeed would burn one and then answer
   * `400`. Its two sibling gate guards (email and SSO allow-lists) already run
   * ahead of the deploy; this one landed behind it.
   */
  if (authType === 'password' && !password && !existingDeployment?.password) {
    return {
      success: false,
      error: 'Password is required when using password protection',
      errorCode: 'validation',
    }
  }

  /**
   * Only deploy when the draft drifted from the active version, and never
   * while another attempt is in flight — a blocked retry must not admit a
   * fresh deployment version on top of the pending one.
   */
  const deploymentSummary = await getWorkflowDeploymentSummary(workflowId)
  const attemptStatus = deploymentSummary.latestDeploymentAttempt?.status
  if (attemptStatus === 'preparing' || attemptStatus === 'activating') {
    return {
      success: false,
      error:
        'A workflow deployment is still preparing. Retry chat deployment after it becomes active.',
      errorCode: 'conflict',
    }
  }

  const needsRedeploy =
    !deploymentSummary.activeDeployment || (await checkNeedsRedeployment(workflowId))

  let deployResult: Awaited<ReturnType<typeof performFullDeploy>> | null = null
  if (needsRedeploy) {
    deployResult = await performFullDeploy({
      workflowId,
      userId,
      actorId: params.actorId,
      actor: params.actor,
      requestId: params.requestId,
      versionDescription: params.versionDescription,
      versionName: params.versionName,
      idempotencyKey: params.idempotencyKey,
      captureAnalytics: params.captureDeploymentAnalytics,
    })
    if (!deployResult.success) {
      return {
        success: false,
        error: deployResult.error || 'Failed to deploy workflow',
        errorCode: deployResult.errorCode ?? 'internal',
      }
    }
    if (deployResult.latestDeploymentAttempt?.isCurrent === false) {
      return {
        success: false,
        error:
          'The workflow deployment attempt is historical and no longer describes production. Retry chat deployment as a new tool call.',
        errorCode: 'conflict',
      }
    }
    if (deployResult.latestDeploymentAttempt?.status !== 'active') {
      return {
        success: false,
        error:
          deployResult.warnings?.[0] ??
          'Workflow deployment is still preparing. Retry chat deployment after it becomes active.',
        errorCode: 'conflict',
      }
    }
    if (!deployResult.activeDeployment) {
      return {
        success: false,
        error: 'Workflow deployment reported active without a live deployment version.',
        errorCode: 'internal',
      }
    }
  }

  let encryptedPassword: string | null = null
  if (authType === 'password' && password) {
    const { encrypted } = await encryptSecret(password)
    encryptedPassword = encrypted
  }

  /**
   * A password-protected chat must end up with a stored password. Both HTTP
   * routes already reject this; without the same guard here a copilot
   * `deploy_as_chat` call could create one with no password, which fails closed at
   * login with an opaque "Authentication configuration error".
   */
  if (authType === 'password' && !encryptedPassword && !existingDeployment?.password) {
    return {
      success: false,
      error: 'Password is required when using password protection',
      errorCode: 'validation',
    }
  }

  let chatId: string
  if (existingDeployment) {
    chatId = existingDeployment.id

    let passwordToStore: string | null
    if (authType === 'password') {
      passwordToStore = encryptedPassword || existingDeployment.password
    } else {
      passwordToStore = null
    }

    await db
      .update(chat)
      .set({
        identifier,
        title,
        description: description || null,
        customizations,
        authType,
        password: passwordToStore,
        allowedEmails: authType === 'email' || authType === 'sso' ? allowedEmails : [],
        outputConfigs,
        includeThinking,
        includeToolCalls,
        updatedAt: new Date(),
      })
      .where(eq(chat.id, chatId))
  } else {
    chatId = generateId()
    await db.insert(chat).values({
      id: chatId,
      workflowId,
      userId,
      identifier,
      title,
      description: description || null,
      customizations,
      isActive: true,
      authType,
      password: encryptedPassword,
      allowedEmails: authType === 'email' || authType === 'sso' ? allowedEmails : [],
      outputConfigs,
      includeThinking,
      includeToolCalls,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  const chatUrl = buildChatDeploymentUrl(identifier)

  logger.info(`Chat "${title}" deployed successfully at ${chatUrl}`)

  if (params.captureLegacyTelemetry !== false) {
    try {
      const { PlatformEvents } = await import('@/lib/core/telemetry')
      PlatformEvents.chatDeployed({
        chatId,
        workflowId,
        authType,
        hasOutputConfigs: outputConfigs.length > 0,
      })
    } catch (_e) {}
  }

  if (params.projectLegacyAudit !== false) {
    recordAudit({
      workspaceId: params.workspaceId || null,
      actorId: userId,
      action: AuditAction.CHAT_DEPLOYED,
      resourceType: AuditResourceType.CHAT,
      resourceId: chatId,
      resourceName: title,
      description: `Deployed chat "${title}"`,
      metadata: {
        workflowId,
        identifier,
        authType,
        chatUrl,
        isUpdate: !!existingDeployment,
        hasOutputConfigs: outputConfigs.length > 0,
        hasCustomizations: !!(
          params.customizations?.primaryColor ||
          params.customizations?.welcomeMessage ||
          params.customizations?.imageUrl
        ),
      },
    })
  }

  return {
    success: true,
    chatId,
    chatUrl,
    deployedAt: deployResult?.deployedAt ?? toDeployedAtDate(deploymentSummary),
    version: deployResult?.version ?? deploymentSummary.activeDeployment?.version,
    isUpdate: Boolean(existingDeployment),
  }
}

function toDeployedAtDate(summary: {
  activeDeployment: { deployedAt: string } | null
}): Date | null {
  return summary.activeDeployment ? new Date(summary.activeDeployment.deployedAt) : null
}

export interface PerformChatUndeployParams {
  chatId: string
  userId: string
  workspaceId?: string | null
  projectLegacyAudit?: boolean
}

export interface PerformChatUndeployResult {
  success: boolean
  error?: string
  /**
   * How a failure should be classified. Callers must not render an unclassified
   * failure as a not-found: an infrastructure fault concealed as `404` tells the
   * caller the deployment is gone when it is still serving.
   */
  errorCode?: OrchestrationErrorCode
}

/**
 * Undeploys a chat: deletes the chat record and records an audit entry.
 * Both the chat manage DELETE route and the copilot `deploy_as_chat` undeploy
 * action must use this function.
 */
export async function performChatUndeploy(
  params: PerformChatUndeployParams
): Promise<PerformChatUndeployResult> {
  const { chatId, userId, workspaceId } = params

  const [chatRecord] = await db
    .select({
      title: chat.title,
      workflowId: chat.workflowId,
      identifier: chat.identifier,
      authType: chat.authType,
    })
    .from(chat)
    .where(eq(chat.id, chatId))
    .limit(1)

  if (!chatRecord) {
    return { success: false, error: 'Chat not found', errorCode: 'not_found' }
  }

  await db.delete(chat).where(eq(chat.id, chatId))

  logger.info(`Chat "${chatId}" deleted successfully`)

  if (params.projectLegacyAudit !== false) {
    recordAudit({
      workspaceId: workspaceId || null,
      actorId: userId,
      action: AuditAction.CHAT_DELETED,
      resourceType: AuditResourceType.CHAT,
      resourceId: chatId,
      resourceName: chatRecord.title || chatId,
      description: `Deleted chat deployment "${chatRecord.title || chatId}"`,
      metadata: {
        workflowId: chatRecord.workflowId || undefined,
        identifier: chatRecord.identifier || undefined,
        authType: chatRecord.authType || undefined,
      },
    })
  }

  return { success: true }
}
