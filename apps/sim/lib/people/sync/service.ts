import { db } from '@sim/db'
import {
  peopleDirectoryScimChange as change,
  scimConnection,
  peopleDirectorySync as sync,
} from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import type { PeopleSyncConfig, PeopleSyncStatus } from '@/lib/api/contracts/people-sync'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { oktaDirectoryHost } from '@/lib/people/provider-import'
import { lockProfiles } from '@/lib/people/repository'
import { CLEARED_RUN, RELEASED, runDirectorySync } from '@/lib/people/sync/runner'
import { pendingScimChange, scimSyncPaused } from '@/lib/people/sync/scim-changes'
import { discardStage } from '@/lib/people/sync/stage'
import { isScimEntitledForOrganization } from '@/ee/scim/lib/entitlement'

const statusColumns = {
  source: sync.source,
  changedAt: pendingScimChange,
  paused: scimSyncPaused,
  sourceTarget: sync.sourceTarget,
  clientId: sync.clientId,
  lastAttemptAt: sync.lastAttemptAt,
  lastSuccessAt: sync.lastSuccessAt,
  lastFailedAt: sync.lastFailedAt,
  lastError: sync.lastError,
  phase: sync.phase,
  usersRead: sync.usersRead,
  retryCount: sync.retryCount,
  nextSyncAt: sync.nextSyncAt,
  leaseExpiresAt: sync.leaseExpiresAt,
}

export async function getDirectorySync(organizationId: string): Promise<PeopleSyncStatus | null> {
  const [row] = await db
    .select(statusColumns)
    .from(sync)
    .where(eq(sync.organizationId, organizationId))
  if (!row) return null
  const now = Date.now()
  const nextSyncAt =
    row.changedAt && row.changedAt < row.nextSyncAt ? row.changedAt : row.nextSyncAt
  const running = row.leaseExpiresAt && row.leaseExpiresAt.getTime() > now
  return {
    source: row.source,
    ...(row.source === 'okta' ? { domain: row.sourceTarget } : {}),
    ...(row.source === 'entra'
      ? { tenantId: row.sourceTarget, clientId: row.clientId ?? undefined }
      : {}),
    state: row.paused
      ? 'paused'
      : running
        ? 'syncing'
        : row.lastError
          ? 'failed'
          : row.phase || row.changedAt || row.nextSyncAt.getTime() <= now
            ? 'queued'
            : 'scheduled',
    progress: !row.paused && row.phase ? { phase: row.phase, usersRead: row.usersRead } : null,
    retryAt: !row.paused && row.lastError && !running ? nextSyncAt.toISOString() : null,
    retryBlocked: !row.paused && !row.changedAt && row.retryCount > 0 && nextSyncAt.getTime() > now,
    lastAttemptAt: row.lastAttemptAt?.toISOString() ?? null,
    lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
    lastFailedAt: row.lastFailedAt?.toISOString() ?? null,
    lastError: row.lastError,
    nextSyncAt: row.paused ? null : nextSyncAt.toISOString(),
  }
}

async function storedConfig(organizationId: string, config: PeopleSyncConfig) {
  if (config.source === 'scim') {
    if (!(await isScimEntitledForOrganization(organizationId)))
      throw new OrchestrationError(
        'forbidden',
        'Directory provisioning is unavailable for this organization.'
      )
    const [connection] = await db
      .select({ id: scimConnection.id })
      .from(scimConnection)
      .where(
        and(eq(scimConnection.organizationId, organizationId), eq(scimConnection.status, 'active'))
      )
    if (!connection)
      throw new OrchestrationError(
        'validation',
        'Enable SCIM provisioning before connecting People.'
      )
    return { sourceTarget: connection.id, clientId: null, encryptedCredential: null }
  }
  if (config.source === 'entra') {
    const { encrypted } = await encryptSecret(config.clientSecret)
    return {
      sourceTarget: config.tenantId.toLowerCase(),
      clientId: config.clientId,
      encryptedCredential: encrypted,
    }
  }
  const domain = oktaDirectoryHost(config.domain)
  const { encrypted } = await encryptSecret(config.token)
  return { sourceTarget: domain, clientId: null, encryptedCredential: encrypted }
}

/** Rotating a credential fences the previous run without discarding its last successful chart. */
export async function configureDirectorySync(
  organizationId: string,
  config: PeopleSyncConfig,
  actorUserId: string
) {
  const stored = await storedConfig(organizationId, config)
  await db.transaction(async (tx) => {
    await lockProfiles(tx, organizationId)
    const [existing] = await tx
      .select({
        source: sync.source,
        target: sync.sourceTarget,
        retryCount: sync.retryCount,
        nextSyncAt: sync.nextSyncAt,
        lastError: sync.lastError,
      })
      .from(sync)
      .where(eq(sync.organizationId, organizationId))
      .for('update')
    if (
      existing &&
      (existing.source !== config.source || existing.target !== stored.sourceTarget)
    ) {
      throw new OrchestrationError(
        'conflict',
        'Disconnect the current directory before connecting a different source or tenant.'
      )
    }
    await discardStage(tx, organizationId)
    const coolingDown =
      existing && existing.retryCount > 0 && existing.nextSyncAt.getTime() > Date.now()
    const values = {
      ...CLEARED_RUN,
      ...RELEASED,
      ...stored,
      configuredBy: actorUserId,
      nextSyncAt: coolingDown ? existing.nextSyncAt : new Date(),
      retryCount: coolingDown ? existing.retryCount : 0,
      lastError: coolingDown ? existing.lastError : null,
    }
    await tx
      .insert(sync)
      .values({ organizationId, source: config.source, ...values })
      .onConflictDoUpdate({
        target: sync.organizationId,
        set: values,
      })
  })
  return requestDirectorySync(organizationId)
}

export async function disconnectDirectorySync(organizationId: string) {
  await db.transaction(async (tx) => {
    await lockProfiles(tx, organizationId)
    await tx.delete(sync).where(eq(sync.organizationId, organizationId))
    await tx.delete(change).where(eq(change.organizationId, organizationId))
  })
}

export async function requestDirectorySync(organizationId: string): Promise<PeopleSyncStatus> {
  await runDirectorySync(organizationId, 'manual')
  const status = await getDirectorySync(organizationId)
  if (!status) throw new OrchestrationError('not_found', 'No directory is connected.')
  return status
}
