import crypto from 'crypto'
import { db } from '@sim/db'
import { chat } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq, isNull } from 'drizzle-orm'
import { AuditAction, AuditResourceType, recordAudit } from '@/lib/audit/log'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { performFullDeploy } from '@/lib/workflows/orchestration/deploy'

const logger = createLogger('ChatDeployOrchestration')

export interface ChatDeployPayload {
  workflowId: string
  userId: string
  identifier: string
  title: string
  description?: string
  customizations?: { primaryColor?: string; welcomeMessage?: string; imageUrl?: string }
  authType?: 'public' | 'password' | 'email' | 'sso'
  password?: string | null
  allowedEmails?: string[]
  outputConfigs?: Array<{ blockId: string; path: string }>
  workspaceId?: string | null
}

export interface PerformChatDeployResult {
  success: boolean
  chatId?: string
  chatUrl?: string
  error?: string
}

/**
 * Deploys a chat: deploys the underlying workflow via `performFullDeploy`,
 * encrypts passwords, creates or updates the chat record, fires telemetry,
 * and records an audit entry. Both the chat API route and the copilot
 * `deploy_chat` tool must use this function.
 */
export async function performChatDeploy(
  params: ChatDeployPayload
): Promise<PerformChatDeployResult> {
  const {
    workflowId,
    userId,
    identifier,
    title,
    description = '',
    authType = 'public',
    password,
    allowedEmails = [],
    outputConfigs = [],
  } = params

  const customizations = {
    primaryColor: params.customizations?.primaryColor || 'var(--brand-hover)',
    welcomeMessage: params.customizations?.welcomeMessage || 'Hi there! How can I help you today?',
    ...(params.customizations?.imageUrl ? { imageUrl: params.customizations.imageUrl } : {}),
  }

  const deployResult = await performFullDeploy({ workflowId, userId })
  if (!deployResult.success) {
    return { success: false, error: deployResult.error || 'Failed to deploy workflow' }
  }

  let encryptedPassword: string | null = null
  if (authType === 'password' && password) {
    const { encrypted } = await encryptSecret(password)
    encryptedPassword = encrypted
  }

  const [existingDeployment] = await db
    .select()
    .from(chat)
    .where(and(eq(chat.workflowId, workflowId), isNull(chat.archivedAt)))
    .limit(1)

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
        updatedAt: new Date(),
      })
      .where(eq(chat.id, chatId))
  } else {
    chatId = crypto.randomUUID()
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
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  const baseUrl = getBaseUrl()
  let chatUrl: string
  try {
    const url = new URL(baseUrl)
    let host = url.host
    if (host.startsWith('www.')) {
      host = host.substring(4)
    }
    chatUrl = `${url.protocol}//${host}/chat/${identifier}`
  } catch {
    chatUrl = `${baseUrl}/chat/${identifier}`
  }

  logger.info(`Chat "${title}" deployed successfully at ${chatUrl}`)

  try {
    const { PlatformEvents } = await import('@/lib/core/telemetry')
    PlatformEvents.chatDeployed({
      chatId,
      workflowId,
      authType,
      hasOutputConfigs: outputConfigs.length > 0,
    })
  } catch (_e) {
    // Telemetry is best-effort
  }

  recordAudit({
    workspaceId: params.workspaceId || null,
    actorId: userId,
    action: AuditAction.CHAT_DEPLOYED,
    resourceType: AuditResourceType.CHAT,
    resourceId: chatId,
    resourceName: title,
    description: `Deployed chat "${title}"`,
    metadata: { workflowId, identifier, authType },
  })

  return { success: true, chatId, chatUrl }
}

export interface PerformChatUndeployParams {
  chatId: string
  userId: string
  workspaceId?: string | null
}

export interface PerformChatUndeployResult {
  success: boolean
  error?: string
}

/**
 * Undeploys a chat: deletes the chat record and records an audit entry.
 * Both the chat manage DELETE route and the copilot `deploy_chat` undeploy
 * action must use this function.
 */
export async function performChatUndeploy(
  params: PerformChatUndeployParams
): Promise<PerformChatUndeployResult> {
  const { chatId, userId, workspaceId } = params

  const [chatRecord] = await db.select().from(chat).where(eq(chat.id, chatId)).limit(1)

  if (!chatRecord) {
    return { success: false, error: 'Chat not found' }
  }

  await db.delete(chat).where(eq(chat.id, chatId))

  logger.info(`Chat "${chatId}" deleted successfully`)

  recordAudit({
    workspaceId: workspaceId || null,
    actorId: userId,
    action: AuditAction.CHAT_DELETED,
    resourceType: AuditResourceType.CHAT,
    resourceId: chatId,
    resourceName: chatRecord.title || chatId,
    description: `Deleted chat deployment "${chatRecord.title || chatId}"`,
  })

  return { success: true }
}
