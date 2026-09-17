import { db } from '@sim/db'
import { mothershipInboxWebhook, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import { getBaseUrl } from '@/lib/core/utils/urls'
import * as agentmail from '@/lib/mothership/inbox/agentmail-client'
import {
  cancelInboxCleanup,
  enqueueInboxCleanup,
  type InboxCleanupPayload,
  processInboxCleanupNow,
} from '@/lib/mothership/inbox/cleanup-outbox'
import type { AgentMailInbox, AgentMailWebhook, InboxConfig } from '@/lib/mothership/inbox/types'

const logger = createLogger('InboxLifecycle')
type InboxExecutor = Pick<typeof db, 'select'>

async function loadInbox(executor: InboxExecutor, workspaceId: string, lock = false) {
  if (lock) {
    await executor
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1)
      .for('update')
  }
  const query = executor
    .select({
      enabled: workspace.inboxEnabled,
      address: workspace.inboxAddress,
      providerId: workspace.inboxProviderId,
      webhookId: mothershipInboxWebhook.webhookId,
    })
    .from(workspace)
    .leftJoin(mothershipInboxWebhook, eq(mothershipInboxWebhook.workspaceId, workspace.id))
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  const [current] = await query
  if (!current) throw new Error('Workspace not found')
  return current
}

type InboxState = Awaited<ReturnType<typeof loadInbox>>

function assertUnchanged(current: InboxState, expected: InboxState): void {
  if (
    current.enabled !== expected.enabled ||
    current.providerId !== expected.providerId ||
    current.webhookId !== expected.webhookId
  ) {
    throw new Error('Inbox settings changed. Refresh and try again.')
  }
}

async function captureCleanup(current: InboxState): Promise<InboxCleanupPayload> {
  const inbox = current.providerId ? await agentmail.getInbox(current.providerId) : null
  return {
    inboxId: inbox?.inbox_id ?? null,
    inboxCreatedAt: inbox?.created_at ?? null,
    webhookId: current.webhookId,
  }
}

/** Only used before activation can have committed, so direct rollback cannot delete a live inbox. */
async function rollbackUninstalledResources(
  inbox: AgentMailInbox,
  webhook: AgentMailWebhook | null
) {
  const results = await Promise.allSettled([
    ...(webhook ? [agentmail.deleteWebhook(webhook.webhook_id)] : []),
    agentmail.deleteInbox(inbox.inbox_id),
  ])
  if (results.some((result) => result.status === 'rejected' || !result.value)) {
    logger.error('Inbox provisioning rollback needs reconciliation', {
      inboxId: inbox.inbox_id,
      webhookId: webhook?.webhook_id,
    })
  }
}

async function rollbackProvisioning(inbox: AgentMailInbox, webhook: AgentMailWebhook | null) {
  try {
    const eventId = await enqueueInboxCleanup(db, {
      inboxId: inbox.inbox_id,
      inboxCreatedAt: inbox.created_at,
      webhookId: webhook?.webhook_id ?? null,
    })
    await processInboxCleanupNow(eventId)
  } catch (error) {
    await rollbackUninstalledResources(inbox, webhook)
    logger.error('Failed to queue inbox provisioning rollback', {
      inboxId: inbox.inbox_id,
      webhookId: webhook?.webhook_id,
      error,
    })
  }
}

async function provisionInbox(username?: string) {
  const inbox = await agentmail.createInbox({ username, displayName: 'Sim' })
  if (!inbox?.inbox_id || !inbox.created_at) {
    throw new Error('Email service returned an invalid inbox')
  }
  try {
    const webhook = await agentmail.createWebhook({
      url: `${getBaseUrl()}/api/webhooks/agentmail`,
      eventTypes: ['message.received'],
      inboxIds: [inbox.inbox_id],
    })
    return { inbox, webhook }
  } catch (error) {
    await rollbackProvisioning(inbox, null)
    throw error
  }
}

async function installInbox(
  workspaceId: string,
  expected: InboxState,
  username?: string,
  cleanup?: InboxCleanupPayload
): Promise<InboxConfig> {
  const { inbox, webhook } = await provisionInbox(username)
  let rollbackEventId: string
  try {
    rollbackEventId = await enqueueInboxCleanup(
      db,
      {
        inboxId: inbox.inbox_id,
        inboxCreatedAt: inbox.created_at,
        webhookId: webhook.webhook_id,
      },
      new Date(Date.now() + 5 * 60_000)
    )
  } catch (error) {
    await rollbackUninstalledResources(inbox, webhook)
    throw error
  }
  let cleanupEventId: string | undefined
  try {
    await db.transaction(async (tx) => {
      assertUnchanged(await loadInbox(tx, workspaceId, true), expected)
      await cancelInboxCleanup(tx, rollbackEventId)
      if (cleanup) cleanupEventId = await enqueueInboxCleanup(tx, cleanup)
      await tx
        .delete(mothershipInboxWebhook)
        .where(eq(mothershipInboxWebhook.workspaceId, workspaceId))
      await tx.insert(mothershipInboxWebhook).values({
        id: generateId(),
        workspaceId,
        webhookId: webhook.webhook_id,
        secret: webhook.secret,
      })
      await tx
        .update(workspace)
        .set({
          inboxEnabled: true,
          inboxAddress: inbox.inbox_id,
          inboxProviderId: inbox.inbox_id,
          updatedAt: new Date(),
        })
        .where(eq(workspace.id, workspaceId))
    })
  } catch (error) {
    await processInboxCleanupNow(rollbackEventId)
    throw error
  }
  if (cleanupEventId) await processInboxCleanupNow(cleanupEventId)
  return { enabled: true, address: inbox.inbox_id, providerId: inbox.inbox_id }
}

/** Provisions resources before atomically activating their inbox and webhook configuration. */
export async function enableInbox(
  workspaceId: string,
  opts?: { username?: string }
): Promise<InboxConfig> {
  const current = await loadInbox(db, workspaceId)
  if (current.enabled || current.providerId || current.webhookId) {
    throw new Error('Inbox is already configured. Refresh and try again.')
  }
  return installInbox(workspaceId, current, opts?.username)
}

/** Stops mail processing atomically and retains provider cleanup in the outbox until it succeeds. */
export async function disableInbox(workspaceId: string): Promise<void> {
  const current = await loadInbox(db, workspaceId)
  const cleanup = await captureCleanup(current)
  const eventId = await db.transaction(async (tx) => {
    assertUnchanged(await loadInbox(tx, workspaceId, true), current)
    const eventId = await enqueueInboxCleanup(tx, cleanup)
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
    return eventId
  })
  await processInboxCleanupNow(eventId)
}

/** Keeps the existing inbox intact until its replacement is provisioned and committed. */
export async function updateInboxAddress(
  workspaceId: string,
  newUsername: string
): Promise<InboxConfig> {
  const current = await loadInbox(db, workspaceId)
  const cleanup = await captureCleanup(current)
  return installInbox(workspaceId, current, newUsername, cleanup)
}
