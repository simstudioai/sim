import { db, mothershipInboxWebhook, workspace } from '@sim/db'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { getBaseUrl } from '@/lib/core/utils/urls'
import * as agentmail from '@/lib/mothership/inbox/agentmail-client'
import type { InboxConfig } from '@/lib/mothership/inbox/types'

const logger = createLogger('InboxLifecycle')

/**
 * Enable inbox for a workspace:
 * 1. Create AgentMail inbox (with optional custom username)
 * 2. Create AgentMail webhook scoped to this inbox
 * 3. Store inbox details + webhook secret in DB
 * 4. Update workspace.inboxEnabled = true
 */
export async function enableInbox(
  workspaceId: string,
  opts?: { username?: string }
): Promise<InboxConfig> {
  const inbox = await agentmail.createInbox({
    username: opts?.username,
    displayName: 'Sim',
  })

  logger.info('AgentMail createInbox response', { inbox: JSON.stringify(inbox) })

  if (!inbox?.inbox_id) {
    throw new Error('AgentMail createInbox response missing inbox_id')
  }

  let webhook: Awaited<ReturnType<typeof agentmail.createWebhook>> | null = null
  try {
    /**
     * The receiver routes a delivery to this workspace by the `message.inbox_id`
     * in the envelope, so it can only accept event types that carry a message.
     * Adding one that does not would make those deliveries unroutable.
     */
    webhook = await agentmail.createWebhook({
      url: `${getBaseUrl()}/api/webhooks/agentmail`,
      eventTypes: ['message.received'],
      inboxIds: [inbox.inbox_id],
    })

    await db.insert(mothershipInboxWebhook).values({
      id: generateId(),
      workspaceId,
      webhookId: webhook.webhook_id,
      secret: webhook.secret,
    })

    await db
      .update(workspace)
      .set({
        inboxEnabled: true,
        inboxAddress: inbox.inbox_id,
        inboxProviderId: inbox.inbox_id,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, workspaceId))

    logger.info('Inbox enabled', { workspaceId, address: inbox.inbox_id })

    return {
      enabled: true,
      address: inbox.inbox_id,
      providerId: inbox.inbox_id,
    }
  } catch (error) {
    try {
      if (webhook) await agentmail.deleteWebhook(webhook.webhook_id)
      await agentmail.deleteInbox(inbox.inbox_id)
      await db
        .delete(mothershipInboxWebhook)
        .where(eq(mothershipInboxWebhook.workspaceId, workspaceId))
    } catch (rollbackError) {
      logger.error('Failed to rollback AgentMail resources', { rollbackError })
    }
    throw error
  }
}

/**
 * Disable inbox:
 * 1. Delete AgentMail webhook
 * 2. Delete AgentMail inbox
 * 3. Clear workspace inbox columns
 * 4. Delete mothershipInboxWebhook row
 */
export async function disableInbox(workspaceId: string): Promise<void> {
  const [[ws], [webhookRow]] = await Promise.all([
    db
      .select({ inboxProviderId: workspace.inboxProviderId })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    db
      .select({ webhookId: mothershipInboxWebhook.webhookId })
      .from(mothershipInboxWebhook)
      .where(eq(mothershipInboxWebhook.workspaceId, workspaceId))
      .limit(1),
  ])

  const deletePromises: Promise<void>[] = []
  if (webhookRow) {
    deletePromises.push(
      agentmail.deleteWebhook(webhookRow.webhookId).catch((error) => {
        logger.warn('Failed to delete AgentMail webhook', { error })
      })
    )
  }
  if (ws?.inboxProviderId) {
    deletePromises.push(
      agentmail.deleteInbox(ws.inboxProviderId).catch((error) => {
        logger.warn('Failed to delete AgentMail inbox', { error })
      })
    )
  }
  await Promise.all(deletePromises)

  /**
   * Atomic so the two rows cannot disagree. `workspace.inboxProviderId` is
   * uniquely indexed, so a half-applied disable would strand the id of an
   * AgentMail inbox that no longer exists — and the next workspace to claim that
   * same address would then fail to enable at all.
   */
  await db.transaction(async (tx) => {
    await tx
      .delete(mothershipInboxWebhook)
      .where(eq(mothershipInboxWebhook.workspaceId, workspaceId))
    await tx
      .update(workspace)
      .set({
        inboxEnabled: false,
        inboxAddress: null,
        inboxProviderId: null,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, workspaceId))
  })

  logger.info('Inbox disabled', { workspaceId })
}

/**
 * Update inbox address (regenerate):
 * 1. Disable old inbox
 * 2. Enable new inbox with new username
 */
export async function updateInboxAddress(
  workspaceId: string,
  newUsername: string
): Promise<InboxConfig> {
  await disableInbox(workspaceId)
  return enableInbox(workspaceId, { username: newUsername })
}
