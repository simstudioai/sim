import { copilotChats, db, mothershipInboxTask, user, workspace } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getActivelyBannedUserIds, isEmailBlocked } from '@/lib/auth/ban'
import { resolveBillingAttribution } from '@/lib/billing/core/billing-attribution'
import { resolveOrCreateChat } from '@/lib/copilot/chat/lifecycle'
import { appendCopilotChatMessages } from '@/lib/copilot/chat/messages-store'
import { buildIntegrationToolSchemas } from '@/lib/copilot/chat/payload'
import {
  buildPersistedAssistantMessage,
  buildPersistedUserMessage,
} from '@/lib/copilot/chat/persisted-message'
import { generateWorkspaceContext } from '@/lib/copilot/chat/workspace-context'
import { chatPubSub } from '@/lib/copilot/chat-status'
import { MOTHERSHIP_CHAT_DEFAULT_MODEL } from '@/lib/copilot/constants'
import { computeWorkspaceEntitlements } from '@/lib/copilot/entitlements'
import { runHeadlessCopilotLifecycle } from '@/lib/copilot/request/lifecycle/headless'
import { requestChatTitle } from '@/lib/copilot/request/lifecycle/start'
import type { OrchestratorResult } from '@/lib/copilot/request/types'
import { normalizeSecretMountPolicy } from '@/lib/copilot/secret-mount-policy'
import { isDocSandboxEnabled, isHosted } from '@/lib/core/config/env-flags'
import * as agentmail from '@/lib/mothership/inbox/agentmail-client'
import { formatEmailAsMessage } from '@/lib/mothership/inbox/format'
import { sendInboxResponse } from '@/lib/mothership/inbox/response'
import type { AgentMailAttachment } from '@/lib/mothership/inbox/types'
import { buildStorageKeySegment } from '@/lib/uploads/core/storage-key'
import { uploadFile } from '@/lib/uploads/core/storage-service'
import { createFileContent, type MessageContent } from '@/lib/uploads/utils/file-utils'
import {
  checkWorkspaceAccess,
  getUserEntityPermissions,
  type PermissionType,
} from '@/lib/workspaces/permissions/utils'
import { getWorkspaceBilledAccountUserId } from '@/lib/workspaces/utils'

const logger = createLogger('InboxExecutor')

const MAX_BODY_LENGTH = 50_000

/**
 * Execute a mothership inbox task end-to-end:
 * 1. Load task and workspace
 * 2. Resolve user identity
 * 3. Resolve or create chat
 * 4. Build execution context
 * 5. Run orchestrator
 * 6. Send response email
 * 7. Update task status
 */
export async function executeInboxTask(taskId: string): Promise<void> {
  const [inboxTask] = await db
    .select()
    .from(mothershipInboxTask)
    .where(eq(mothershipInboxTask.id, taskId))
    .limit(1)

  if (!inboxTask) {
    logger.error('Inbox task not found', { taskId })
    return
  }

  if (inboxTask.status === 'completed' || inboxTask.status === 'failed') {
    logger.info('Inbox task already terminal, skipping', { taskId, status: inboxTask.status })
    return
  }

  const [ws] = await db
    .select({
      id: workspace.id,
      ownerId: workspace.ownerId,
      inboxProviderId: workspace.inboxProviderId,
      inboxSecretScope: workspace.inboxSecretScope,
      inboxMountedSecrets: workspace.inboxMountedSecrets,
    })
    .from(workspace)
    .where(eq(workspace.id, inboxTask.workspaceId))
    .limit(1)

  if (!ws) {
    logger.error('Workspace not found for inbox task', {
      taskId,
      workspaceId: inboxTask.workspaceId,
    })
    await markTaskFailed(taskId, 'Workspace not found')
    return
  }

  let chatId = inboxTask.chatId
  let responseSent = false

  try {
    const [[claimed], actor] = await Promise.all([
      db
        .update(mothershipInboxTask)
        .set({ status: 'processing', processingStartedAt: new Date() })
        .where(and(eq(mothershipInboxTask.id, taskId), eq(mothershipInboxTask.status, 'received')))
        .returning({ id: mothershipInboxTask.id }),
      resolveInboxExecutionActor(inboxTask.fromEmail, ws),
    ])
    const userId = actor.executionUserId

    if (!claimed) {
      logger.info('Task already claimed by another execution, skipping', { taskId })
      return
    }

    // Blocked senders and banned accounts must not drive the agent; the sender
    // email is checked directly (domain list + the sender's own account ban)
    // because non-members resolve to the workspace owner, and the workspace
    // billed account is checked to match preprocessExecution's gate. Fails
    // closed on lookup errors. No email response in any of these paths —
    // never mail a suspended account.
    let blockReason: string | null = null
    try {
      const [senderBlocked, billedAccountUserId] = await Promise.all([
        isEmailBlocked(inboxTask.fromEmail),
        getWorkspaceBilledAccountUserId(ws.id),
      ])
      const bannedUserIds = await getActivelyBannedUserIds(
        billedAccountUserId ? [userId, billedAccountUserId] : [userId]
      )
      if (senderBlocked || bannedUserIds.length > 0) {
        logger.warn('Blocking inbox task: sender, resolved user, or billed account is banned', {
          taskId,
          userId,
          senderBlocked,
          bannedUserIds,
        })
        blockReason = 'User account is suspended'
      }
    } catch (error) {
      logger.error('Inbox task ban check failed; failing closed', {
        taskId,
        error: getErrorMessage(error, 'Unknown error'),
      })
      blockReason = 'Unable to verify account status'
    }
    if (blockReason) {
      responseSent = true
      await markTaskFailed(taskId, blockReason)
      return
    }

    if (!chatId) {
      const chatResult = await resolveOrCreateChat({
        userId,
        workspaceId: ws.id,
        model: MOTHERSHIP_CHAT_DEFAULT_MODEL,
        type: 'mothership',
      })
      chatId = chatResult.chatId

      await db.update(mothershipInboxTask).set({ chatId }).where(eq(mothershipInboxTask.id, taskId))

      const titleInput =
        inboxTask.subject !== '(no subject)'
          ? `${inboxTask.subject}\n\n${inboxTask.bodyPreview || ''}`
          : inboxTask.bodyPreview || inboxTask.bodyText?.substring(0, 500) || ''

      requestChatTitle({
        message: titleInput,
        model: 'claude-opus-4-8',
        userId,
        workspaceId: ws.id,
      })
        .then(async (title) => {
          if (title && chatId) {
            // Only stamp the generated title while the chat has none. This
            // resolves asynchronously, so a user could rename the chat in the
            // meantime; the `isNull` guard makes the write lose that race
            // instead of clobbering the explicit rename.
            const stamped = await db
              .update(copilotChats)
              .set({ title })
              .where(and(eq(copilotChats.id, chatId), isNull(copilotChats.title)))
              .returning({ id: copilotChats.id })
            // The rename won — do not announce a title the row no longer holds.
            if (stamped.length === 0) return
            chatPubSub?.publishStatusChanged({
              workspaceId: ws.id,
              chatId,
              type: 'renamed',
            })
          }
        })
        .catch((err) => {
          logger.warn('Failed to generate chat title', { chatId, err })
        })

      chatPubSub?.publishStatusChanged({
        workspaceId: ws.id,
        chatId,
        type: 'created',
      })
    }

    const userMessageId = generateId()

    if (chatId) {
      chatPubSub?.publishStatusChanged({
        workspaceId: ws.id,
        chatId,
        type: 'started',
        streamId: userMessageId,
      })
    }

    const fetchAttachments = async () => {
      let attachments: AgentMailAttachment[] = []
      if (inboxTask.hasAttachments && ws.inboxProviderId && inboxTask.agentmailMessageId) {
        try {
          const fullMessage = await agentmail.getMessage(
            ws.inboxProviderId,
            inboxTask.agentmailMessageId
          )
          attachments = fullMessage.attachments || []
        } catch (attachErr) {
          logger.warn('Failed to fetch attachment metadata', { taskId, attachErr })
        }
      }
      const downloaded = await downloadAttachmentContents(
        attachments,
        ws.inboxProviderId,
        inboxTask.agentmailMessageId,
        taskId,
        userId
      )
      return { attachments, ...downloaded }
    }

    const workspaceAccess = await checkWorkspaceAccess(ws.id, userId)
    const userPermission = inboxToolPermission(actor, workspaceAccess.permission)
    const secretMountPolicy = normalizeSecretMountPolicy({
      secretScope: ws.inboxSecretScope,
      mountedSecrets: ws.inboxMountedSecrets,
    })
    const [attachmentResult, workspaceContext, integrationTools, billingAttribution, entitlements] =
      await Promise.all([
        fetchAttachments(),
        generateWorkspaceContext(ws.id, userId, { workspaceAccess, secretMountPolicy }),
        buildIntegrationToolSchemas(userId, undefined, ws.id),
        resolveBillingAttribution({ actorUserId: userId, workspaceId: ws.id }),
        computeWorkspaceEntitlements(ws.id, userId),
      ])
    const { attachments, fileAttachments, storedAttachments } = attachmentResult

    const truncatedTask = {
      ...inboxTask,
      bodyText: inboxTask.bodyText?.substring(0, MAX_BODY_LENGTH) ?? null,
      bodyHtml: inboxTask.bodyHtml?.substring(0, MAX_BODY_LENGTH) ?? null,
    }
    const messageContent = formatEmailAsMessage(truncatedTask, attachments)

    const requestPayload: Record<string, unknown> = {
      message: messageContent,
      userId,
      chatId,
      mode: 'agent',
      messageId: userMessageId,
      isHosted,
      workspaceContext,
      ...(isDocSandboxEnabled ? { docCompiler: 'python' } : {}),
      ...(integrationTools.length > 0 ? { integrationTools } : {}),
      ...(userPermission ? { userPermission } : {}),
      ...(entitlements.length > 0 ? { entitlements } : {}),
      ...(fileAttachments.length > 0 ? { fileAttachments } : {}),
    }

    const result = await runHeadlessCopilotLifecycle(requestPayload, {
      userId,
      workspaceId: ws.id,
      chatId: chatId ?? undefined,
      goRoute: '/api/mothership/execute',
      autoExecuteTools: true,
      interactive: false,
      billingAttribution,
      ...(userPermission ? { userPermission } : {}),
      secretActorUserId: actor.secretActorUserId,
      secretMountPolicy,
    })

    const cleanContent = stripThinkingTags(result.content || '')

    if (chatId) {
      await persistChatMessages(
        chatId,
        userMessageId,
        messageContent,
        {
          ...result,
          content: cleanContent,
        },
        storedAttachments
      )
    }

    const finalStatus = result.success ? 'completed' : 'failed'
    const updatedTask = { ...inboxTask, chatId }
    const errorStr = result.error || result.errors?.join('; ')

    const responseMessageId = await sendInboxResponse(
      updatedTask,
      { success: result.success, content: cleanContent, error: errorStr },
      { inboxProviderId: ws.inboxProviderId, workspaceId: ws.id }
    )
    responseSent = responseMessageId !== null

    await db
      .update(mothershipInboxTask)
      .set({
        status: finalStatus,
        resultSummary: cleanContent?.substring(0, 200) || null,
        errorMessage: errorStr || null,
        completedAt: new Date(),
        ...(responseMessageId ? { responseMessageId } : {}),
      })
      .where(eq(mothershipInboxTask.id, taskId))

    if (chatId) {
      chatPubSub?.publishStatusChanged({
        workspaceId: ws.id,
        chatId,
        type: 'completed',
        streamId: userMessageId,
      })
    }

    logger.info('Inbox task execution complete', { taskId, status: finalStatus })
  } catch (error) {
    logger.error('Inbox task execution failed', {
      taskId,
      error: getErrorMessage(error, 'Unknown error'),
    })

    await markTaskFailed(taskId, getErrorMessage(error, 'Execution failed'))

    if (!responseSent) {
      try {
        await sendInboxResponse(
          { ...inboxTask, chatId },
          {
            success: false,
            content: '',
            error: getErrorMessage(error, 'Execution failed'),
          },
          { inboxProviderId: ws.inboxProviderId, workspaceId: ws.id }
        )
      } catch (emailError) {
        logger.error('Failed to send error email', { taskId, emailError })
      }
    }
  }
}

/**
 * Resolve the execution and raw-secret actors independently. Workspace members
 * execute and mount secrets as themselves. External senders retain the existing
 * owner execution fallback but receive no raw-secret actor.
 *
 * The owner fallback exists because billing attribution and workspace reads need
 * a real user, not because an unknown sender should act as the owner. A null
 * `secretActorUserId` is therefore the run's "no caller" signal, and callers must
 * treat it as one everywhere authority is derived — see
 * {@link inboxToolPermission}.
 */
interface InboxExecutionActor {
  executionUserId: string
  /** Null when no workspace member owns this message. */
  secretActorUserId: string | null
}

/**
 * How far an inbox run's tools may reach.
 *
 * An attributed message uses the sender's own workspace permission, which makes an
 * emailed request equivalent to that member performing it in the app — a read-only
 * member still cannot run or edit anything.
 *
 * An unattributed message resolves to the workspace owner so the run has a real
 * user for billing and workspace reads, and the owner is typically an admin. Left
 * alone, that hands an allowlisted external correspondent the owner's write
 * authority: `create_workflow` and `edit_workflow` gate on
 * `requiredPermission: 'write'`, and `run_workflow` is gated by the headless
 * client-fallback bar in `executeTool` — it carries no catalog permission of its
 * own. A workflow built or run through any of them executes with
 * `enforceCredentialAccess`, resolving the owner's workspace *and personal*
 * secrets. That is the same reach `secretActorUserId: null` already refuses for a
 * direct mount, so refusing it here keeps one answer rather than two.
 *
 * Read is the ceiling rather than no permission at all because answering an
 * external correspondent from workspace context is the point of the inbox; only
 * mutation and execution are withheld.
 */
function inboxToolPermission(
  actor: InboxExecutionActor,
  workspacePermission: PermissionType | null
): PermissionType | null {
  if (actor.secretActorUserId !== null) return workspacePermission
  return workspacePermission === null ? null : 'read'
}

async function resolveInboxExecutionActor(
  senderEmail: string,
  ws: { id: string; ownerId: string }
): Promise<InboxExecutionActor> {
  const [matchedUser] = await db
    .select({ id: user.id })
    .from(user)
    .where(sql`lower(${user.email}) = ${senderEmail.toLowerCase()}`)
    .orderBy(user.createdAt)
    .limit(1)

  if (matchedUser) {
    const permission = await getUserEntityPermissions(matchedUser.id, 'workspace', ws.id)
    if (permission !== null) {
      return { executionUserId: matchedUser.id, secretActorUserId: matchedUser.id }
    }
  }

  return { executionUserId: ws.ownerId, secretActorUserId: null }
}

/**
 * Persist the user message and assistant response to the copilot chat.
 * This is necessary because the orchestrator doesn't persist messages —
 * in the interactive UI flow, the client store handles persistence.
 * For background execution, we write directly to the DB.
 */
async function persistChatMessages(
  chatId: string,
  userMessageId: string,
  userContent: string,
  result: OrchestratorResult,
  storedAttachments: StoredAttachment[] = []
): Promise<void> {
  try {
    const userMessage = buildPersistedUserMessage({
      id: userMessageId,
      content: userContent,
      fileAttachments: storedAttachments.length > 0 ? storedAttachments : undefined,
    })

    const assistantMessage = buildPersistedAssistantMessage(result)

    // Best-effort: the email response is the primary deliverable, so a failure
    // here is logged (in the catch below) rather than failing the task.
    await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(copilotChats)
        .set({ updatedAt: new Date() })
        .where(eq(copilotChats.id, chatId))
        .returning({ model: copilotChats.model })
      if (!updated) return
      await appendCopilotChatMessages(
        chatId,
        [userMessage, assistantMessage],
        { chatModel: updated.model ?? null },
        tx
      )
    })
  } catch (err) {
    logger.error('Failed to persist chat messages', {
      chatId,
      error: getErrorMessage(err, 'Unknown error'),
    })
  }
}

function stripThinkingTags(text: string): string {
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<\/?thinking[^>]*>/gi, '')
    .trim()
}

async function markTaskFailed(taskId: string, errorMessage: string): Promise<void> {
  await db
    .update(mothershipInboxTask)
    .set({
      status: 'failed',
      errorMessage,
      completedAt: new Date(),
    })
    .where(eq(mothershipInboxTask.id, taskId))
}

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024

interface StoredAttachment {
  id: string
  key: string
  filename: string
  media_type: string
  size: number
}

interface DownloadedAttachments {
  fileAttachments: Array<MessageContent & { filename: string }>
  storedAttachments: StoredAttachment[]
}

/**
 * Download attachment content from AgentMail, convert to file content objects
 * for the LLM, and upload to copilot storage for chat display.
 */
async function downloadAttachmentContents(
  attachments: AgentMailAttachment[],
  inboxProviderId: string | null,
  messageId: string | null,
  taskId: string,
  userId: string
): Promise<DownloadedAttachments> {
  if (!inboxProviderId || !messageId || attachments.length === 0) {
    return { fileAttachments: [], storedAttachments: [] }
  }

  const eligible = attachments.filter((a) => {
    if (a.size > MAX_ATTACHMENT_SIZE) {
      logger.info('Skipping large attachment', { taskId, filename: a.filename, size: a.size })
      return false
    }
    return true
  })

  const settled = await Promise.allSettled(
    eligible.map(async (attachment) => {
      const arrayBuffer = await agentmail.getAttachment(
        inboxProviderId,
        messageId,
        attachment.attachment_id
      )
      const buffer = Buffer.from(arrayBuffer)
      const fileContent = createFileContent(buffer, attachment.content_type)
      if (!fileContent) return null

      const storageKey = `copilot/${buildStorageKeySegment(
        `${Date.now()}-${attachment.attachment_id}-`,
        attachment.filename
      )}`
      const uploaded = await uploadFile({
        file: buffer,
        fileName: attachment.filename,
        contentType: attachment.content_type,
        context: 'copilot',
        customKey: storageKey,
        preserveKey: true,
        metadata: { userId, originalName: attachment.filename },
      })

      const stored: StoredAttachment = {
        id: attachment.attachment_id,
        key: uploaded.key,
        filename: attachment.filename,
        media_type: attachment.content_type,
        size: buffer.length,
      }

      return { fileContent: { ...fileContent, filename: attachment.filename }, stored }
    })
  )

  const fileAttachments: Array<MessageContent & { filename: string }> = []
  const storedAttachments: StoredAttachment[] = []
  for (let i = 0; i < settled.length; i++) {
    const outcome = settled[i]
    if (outcome.status === 'fulfilled' && outcome.value) {
      fileAttachments.push(outcome.value.fileContent)
      storedAttachments.push(outcome.value.stored)
    } else if (outcome.status === 'rejected') {
      const attachment = eligible[i]
      logger.warn('Failed to download attachment', {
        taskId,
        attachmentId: attachment.attachment_id,
        filename: attachment.filename,
        error: getErrorMessage(outcome.reason, 'Unknown error'),
      })
    }
  }

  logger.info('Downloaded attachment contents', {
    taskId,
    total: attachments.length,
    downloaded: fileAttachments.length,
  })

  return { fileAttachments, storedAttachments }
}
