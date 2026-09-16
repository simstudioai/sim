import { db, mothershipInboxTask, workspace } from '@sim/db'
import { eq, sql } from 'drizzle-orm'
import { hasWorkspaceInboxAccess } from '@/lib/billing/core/subscription'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { disableInbox, enableInbox, updateInboxAddress } from '@/lib/mothership/inbox/lifecycle'
import type { InboxSettingsPatch } from '@/lib/mothership/inbox/settings-input'
import { normalizeSecretMountPolicy } from '@/lib/mothership/secret-mount-policy'

export async function readInboxSettingsRecord(workspaceId: string) {
  const [wsResult, statsResult, entitled] = await Promise.all([
    db
      .select({
        inboxEnabled: workspace.inboxEnabled,
        inboxAddress: workspace.inboxAddress,
        inboxSecretScope: workspace.inboxSecretScope,
        inboxMountedSecrets: workspace.inboxMountedSecrets,
      })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1),
    db
      .select({
        status: mothershipInboxTask.status,
        count: sql<number>`count(*)::int`,
      })
      .from(mothershipInboxTask)
      .where(eq(mothershipInboxTask.workspaceId, workspaceId))
      .groupBy(mothershipInboxTask.status),
    hasWorkspaceInboxAccess(workspaceId),
  ])

  const [ws] = wsResult
  if (!ws) {
    throw new OrchestrationError('not_found', 'Workspace not found')
  }

  const stats = {
    total: 0,
    completed: 0,
    processing: 0,
    failed: 0,
  }
  for (const row of statsResult) {
    const count = Number(row.count)
    stats.total += count
    if (row.status === 'completed') stats.completed = count
    else if (row.status === 'processing') stats.processing = count
    else if (row.status === 'failed') stats.failed = count
  }

  return {
    enabled: ws.inboxEnabled,
    address: ws.inboxAddress,
    ...normalizeSecretMountPolicy({
      secretScope: ws.inboxSecretScope,
      mountedSecrets: ws.inboxMountedSecrets,
    }),
    entitled,
    taskStats: stats,
  }
}

export async function updateInboxSettingsRecord(workspaceId: string, body: InboxSettingsPatch) {
  const [current] = await db
    .select({
      inboxEnabled: workspace.inboxEnabled,
      inboxAddress: workspace.inboxAddress,
      inboxProviderId: workspace.inboxProviderId,
      inboxSecretScope: workspace.inboxSecretScope,
      inboxMountedSecrets: workspace.inboxMountedSecrets,
    })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1)
  if (!current) {
    throw new OrchestrationError('not_found', 'Workspace not found')
  }

  const hasPolicyUpdate = body.secretScope !== undefined || body.mountedSecrets !== undefined
  const secretMountPolicy = normalizeSecretMountPolicy({
    secretScope: body.secretScope ?? current.inboxSecretScope,
    mountedSecrets: body.mountedSecrets ?? current.inboxMountedSecrets,
  })
  const persistPolicy = async () => {
    if (!hasPolicyUpdate) return
    await db
      .update(workspace)
      .set({
        inboxSecretScope: secretMountPolicy.secretScope,
        inboxMountedSecrets: secretMountPolicy.mountedSecrets,
        updatedAt: new Date(),
      })
      .where(eq(workspace.id, workspaceId))
  }

  if (body.enabled === false) {
    await disableInbox(workspaceId)
    await persistPolicy()
    return {
      enabled: false,
      address: null,
      providerId: null,
      ...secretMountPolicy,
    }
  }

  if (body.enabled === undefined && body.username === undefined && hasPolicyUpdate) {
    await persistPolicy()
    return {
      enabled: current.inboxEnabled,
      address: current.inboxAddress,
      providerId: current.inboxProviderId,
      ...secretMountPolicy,
    }
  }

  if (!(await hasWorkspaceInboxAccess(workspaceId))) {
    throw new OrchestrationError('forbidden', 'Sim Mailer requires a Max plan')
  }

  if (body.enabled === true) {
    if (current.inboxEnabled) {
      throw new OrchestrationError('conflict', 'Inbox is already enabled')
    }
    const config = await enableInbox(workspaceId, { username: body.username })
    await persistPolicy()
    return { ...config, ...secretMountPolicy }
  }

  if (body.username) {
    const config = await updateInboxAddress(workspaceId, body.username)
    await persistPolicy()
    return { ...config, ...secretMountPolicy }
  }

  throw new OrchestrationError('validation', 'No valid update provided')
}
