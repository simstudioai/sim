import { db } from '@sim/db'
import { webhook, workflow, workflowDeploymentVersion } from '@sim/db/schema'
import { generateShortId } from '@sim/utils/id'
import { isPlainRecord } from '@sim/utils/object'
import type { DbOrTx } from '@sim/workflow-persistence/types'
import { and, eq, gt, inArray, isNull, lt, lte } from 'drizzle-orm'
import { claimWebhookPath } from '@/lib/webhooks/path-claims'
import { projectDesiredWebhookProviderConfig } from '@/lib/webhooks/provider-subscriptions'
import {
  fingerprintDesiredWebhookRegistration,
  normalizeWebhookRegistrationPath,
} from '@/lib/webhooks/registration-identity'
import { planWebhookRegistrationReconciliation } from '@/lib/webhooks/registration-reconciliation'
import type { DeploymentOperationStatus } from '@/lib/workflows/deployment-lifecycle'
import { isDeploymentOperationCurrent } from '@/lib/workflows/persistence/deployment-operations'

export type WebhookRegistrationRow = typeof webhook.$inferSelect
export type WebhookRegistrationStatus = 'active' | 'candidate' | 'retired' | 'orphaned'

export interface WebhookRegistrationOperationFence {
  workflowId: string
  operationId: string
  generation: number
  deploymentVersionId: string
}

export interface DesiredWebhookRegistrationIntent {
  blockId: string
  provider: string
  path: string | null
  routingKey: string | null
  providerConfig: Record<string, unknown>
  configFingerprint: string
}

export interface PreparedWebhookCandidate {
  desired: DesiredWebhookRegistrationIntent
  row: WebhookRegistrationRow
}

export interface PreparedWebhookRegistrationWork {
  candidates: PreparedWebhookCandidate[]
  orphanedCandidates: WebhookRegistrationRow[]
}

export class StaleWebhookRegistrationOperationError extends Error {
  readonly code = 'stale_webhook_registration_operation'

  constructor(message = 'Webhook registration operation is stale') {
    super(message)
    this.name = 'StaleWebhookRegistrationOperationError'
  }
}

function assertOperationGeneration(generation: number): void {
  if (!Number.isSafeInteger(generation) || generation <= 0) {
    throw new TypeError('Webhook registration generation must be a positive safe integer')
  }
}

async function assertCurrentOperation(
  tx: DbOrTx,
  fence: WebhookRegistrationOperationFence,
  allowedStatuses: readonly DeploymentOperationStatus[]
): Promise<void> {
  assertOperationGeneration(fence.generation)

  const [workflowRow] = await tx
    .select({ id: workflow.id })
    .from(workflow)
    .where(eq(workflow.id, fence.workflowId))
    .for('update')
  if (!workflowRow) {
    throw new StaleWebhookRegistrationOperationError('Webhook registration workflow is missing')
  }

  const isCurrent = await isDeploymentOperationCurrent(
    {
      workflowId: fence.workflowId,
      operationId: fence.operationId,
      generation: fence.generation,
      deploymentVersionId: fence.deploymentVersionId,
      statuses: allowedStatuses,
    },
    tx
  )
  if (!isCurrent) {
    throw new StaleWebhookRegistrationOperationError()
  }
}

function rowProviderConfig(row: WebhookRegistrationRow): Record<string, unknown> {
  return isPlainRecord(row.providerConfig) ? row.providerConfig : {}
}

function rowRegistrationGeneration(row: WebhookRegistrationRow): number {
  if (
    row.registrationGeneration === null ||
    !Number.isSafeInteger(row.registrationGeneration) ||
    row.registrationGeneration < 0
  ) {
    throw new StaleWebhookRegistrationOperationError(
      `Webhook registration ${row.id} has no valid generation`
    )
  }
  return row.registrationGeneration
}

function fingerprintPersistedWebhook(row: WebhookRegistrationRow): string {
  if (!row.provider) {
    throw new Error(`Webhook registration ${row.id} has no provider`)
  }
  return fingerprintDesiredWebhookRegistration({
    provider: row.provider,
    path: row.path,
    routingKey: row.routingKey,
    desiredConfig: projectDesiredWebhookProviderConfig(rowProviderConfig(row)),
  })
}

async function adoptLegacyActiveRows(
  tx: DbOrTx,
  fence: WebhookRegistrationOperationFence
): Promise<void> {
  const [activeVersion] = await tx
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, fence.workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)

  if (!activeVersion) return

  const legacyRows = await tx
    .select()
    .from(webhook)
    .where(
      and(
        eq(webhook.workflowId, fence.workflowId),
        eq(webhook.deploymentVersionId, activeVersion.id),
        isNull(webhook.registrationStatus),
        eq(webhook.isActive, true),
        isNull(webhook.archivedAt)
      )
    )

  const adoptedGeneration = fence.generation - 1
  for (const row of legacyRows) {
    if (!row.blockId || !row.provider) continue
    if (row.path) {
      await claimWebhookPath(tx, {
        path: row.path,
        workflowId: fence.workflowId,
        generation: adoptedGeneration,
      })
    }

    const [adopted] = await tx
      .update(webhook)
      .set({
        registrationStatus: 'active',
        registrationGeneration: adoptedGeneration,
        configFingerprint: fingerprintPersistedWebhook(row),
        preparedAt: row.updatedAt,
      })
      .where(and(eq(webhook.id, row.id), isNull(webhook.registrationStatus)))
      .returning({ id: webhook.id })

    if (!adopted) {
      throw new StaleWebhookRegistrationOperationError(
        `Legacy webhook registration ${row.id} changed during adoption`
      )
    }
  }
}

/**
 * Builds the insert shape that keeps a candidate invisible to every legacy delivery query.
 */
export function buildLegacyInvisibleCandidateValues(input: {
  id: string
  fence: WebhookRegistrationOperationFence
  desired: DesiredWebhookRegistrationIntent
  now: Date
}) {
  return {
    id: input.id,
    workflowId: input.fence.workflowId,
    deploymentVersionId: input.fence.deploymentVersionId,
    registrationStatus: 'candidate' as const,
    registrationGeneration: input.fence.generation,
    configFingerprint: input.desired.configFingerprint,
    preparedAt: null,
    blockId: input.desired.blockId,
    path: normalizeWebhookRegistrationPath(input.desired.path),
    routingKey: input.desired.routingKey,
    provider: input.desired.provider,
    providerConfig: input.desired.providerConfig,
    isActive: false,
    failedCount: 0,
    archivedAt: input.now,
    createdAt: input.now,
    updatedAt: input.now,
  }
}

/**
 * Persists one generation's registration intent before any provider call is made.
 */
export async function prepareWebhookRegistrationIntents(input: {
  fence: WebhookRegistrationOperationFence
  desired: readonly DesiredWebhookRegistrationIntent[]
}): Promise<PreparedWebhookRegistrationWork> {
  return db.transaction(async (tx) => {
    await assertCurrentOperation(tx, input.fence, ['preparing'])
    await adoptLegacyActiveRows(tx, input.fence)

    for (const desired of input.desired) {
      if (desired.path) {
        await claimWebhookPath(tx, {
          path: desired.path,
          workflowId: input.fence.workflowId,
          generation: input.fence.generation,
        })
      }
    }

    const activeRows = await tx
      .select()
      .from(webhook)
      .where(
        and(
          eq(webhook.workflowId, input.fence.workflowId),
          eq(webhook.registrationStatus, 'active'),
          eq(webhook.isActive, true),
          isNull(webhook.archivedAt)
        )
      )

    const activeRegistrations = activeRows
      .filter(
        (row): row is WebhookRegistrationRow & { blockId: string } =>
          typeof row.blockId === 'string'
      )
      .map((row) => ({
        triggerId: row.blockId,
        generation: rowRegistrationGeneration(row),
        fingerprint: row.configFingerprint,
        row,
      }))

    const plan = planWebhookRegistrationReconciliation({
      generation: input.fence.generation,
      desired: input.desired.map((desired) => ({
        triggerId: desired.blockId,
        fingerprint: desired.configFingerprint,
        desired,
      })),
      existing: activeRegistrations,
    })

    const candidateRows = await tx
      .select()
      .from(webhook)
      .where(
        and(
          eq(webhook.workflowId, input.fence.workflowId),
          eq(webhook.registrationStatus, 'candidate')
        )
      )
    const candidatesByBlockId = new Map(
      candidateRows
        .filter(
          (row): row is WebhookRegistrationRow & { blockId: string } =>
            typeof row.blockId === 'string'
        )
        .map((row) => [row.blockId, row])
    )

    /**
     * Orphans left by earlier attempts (their cleanup failed or the process
     * died) are re-collected on every preparation so they cannot leak forever
     * — cleanup itself stays generation-fenced, so racing operations at most
     * duplicate a best-effort provider delete.
     */
    const staleOrphanRows = await tx
      .select()
      .from(webhook)
      .where(
        and(
          eq(webhook.workflowId, input.fence.workflowId),
          eq(webhook.registrationStatus, 'orphaned')
        )
      )

    const candidates: PreparedWebhookCandidate[] = []
    const orphanedCandidates: WebhookRegistrationRow[] = [...staleOrphanRows]
    const now = new Date()

    for (const action of plan.actions) {
      if (action.kind === 'reuse') {
        const currentGeneration = rowRegistrationGeneration(action.existing.row)
        const [updated] = await tx
          .update(webhook)
          .set({
            registrationGeneration: input.fence.generation,
            configFingerprint: action.desired.fingerprint,
            preparedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(webhook.id, action.existing.row.id),
              eq(webhook.registrationStatus, 'active'),
              eq(webhook.registrationGeneration, currentGeneration),
              lte(webhook.registrationGeneration, input.fence.generation)
            )
          )
          .returning()
        if (!updated) throw new StaleWebhookRegistrationOperationError()
        continue
      }

      const desired = action.desired.desired
      const existingCandidate = candidatesByBlockId.get(action.triggerId)
      if (existingCandidate && existingCandidate.configFingerprint === action.desired.fingerprint) {
        if (existingCandidate.registrationGeneration === input.fence.generation) {
          candidates.push({ desired, row: existingCandidate })
          continue
        }
        /**
         * A fingerprint-identical candidate from a superseded attempt is
         * adopted rather than orphaned and reinserted: this preserves any
         * checkpointed provider progress (an external subscription it already
         * created keeps serving instead of being deleted and recreated) and
         * avoids insert churn against the path uniqueness index.
         */
        const [adopted] = await tx
          .update(webhook)
          .set({
            registrationGeneration: input.fence.generation,
            deploymentVersionId: input.fence.deploymentVersionId,
            updatedAt: now,
          })
          .where(
            and(
              eq(webhook.id, existingCandidate.id),
              eq(webhook.registrationStatus, 'candidate'),
              eq(webhook.registrationGeneration, rowRegistrationGeneration(existingCandidate))
            )
          )
          .returning()
        if (!adopted) throw new StaleWebhookRegistrationOperationError()
        candidates.push({ desired, row: adopted })
        continue
      }

      if (existingCandidate) {
        const existingGeneration = rowRegistrationGeneration(existingCandidate)
        const [orphaned] = await tx
          .update(webhook)
          .set({
            registrationStatus: 'orphaned',
            updatedAt: now,
          })
          .where(
            and(
              eq(webhook.id, existingCandidate.id),
              eq(webhook.registrationStatus, 'candidate'),
              eq(webhook.registrationGeneration, existingGeneration)
            )
          )
          .returning()
        if (!orphaned) throw new StaleWebhookRegistrationOperationError()
        orphanedCandidates.push(orphaned)
      }

      const [candidate] = await tx
        .insert(webhook)
        .values(
          buildLegacyInvisibleCandidateValues({
            id: generateShortId(),
            fence: input.fence,
            desired,
            now,
          })
        )
        .returning()
      if (!candidate) throw new Error('Failed to persist webhook registration candidate')
      candidates.push({ desired, row: candidate })
    }

    return { candidates, orphanedCandidates }
  })
}

/** Checkpoints provider-managed candidate state under the operation and generation fences. */
export async function checkpointWebhookCandidate(input: {
  fence: WebhookRegistrationOperationFence
  webhookId: string
  providerConfig: Record<string, unknown>
  prepared?: boolean
}): Promise<WebhookRegistrationRow> {
  return db.transaction(async (tx) => {
    await assertCurrentOperation(tx, input.fence, ['preparing'])
    const now = new Date()
    const [updated] = await tx
      .update(webhook)
      .set({
        providerConfig: input.providerConfig,
        ...(input.prepared === false ? {} : { preparedAt: now }),
        updatedAt: now,
      })
      .where(
        and(
          eq(webhook.id, input.webhookId),
          eq(webhook.workflowId, input.fence.workflowId),
          eq(webhook.registrationStatus, 'candidate'),
          eq(webhook.registrationGeneration, input.fence.generation)
        )
      )
      .returning()
    if (!updated) throw new StaleWebhookRegistrationOperationError()
    return updated
  })
}

/**
 * Atomically promotes prepared candidates, repoints reused rows, and retires superseded rows.
 *
 * This is designed to be passed directly to a v2 deployment operation's activation transaction.
 */
export async function activateWebhookRegistrations(
  tx: DbOrTx,
  fence: WebhookRegistrationOperationFence
): Promise<void> {
  await assertCurrentOperation(tx, fence, ['active'])

  const unpreparedCandidates = await tx
    .select({ id: webhook.id })
    .from(webhook)
    .where(
      and(
        eq(webhook.workflowId, fence.workflowId),
        eq(webhook.registrationStatus, 'candidate'),
        eq(webhook.registrationGeneration, fence.generation),
        isNull(webhook.preparedAt)
      )
    )
    .limit(1)
  if (unpreparedCandidates.length > 0) {
    throw new Error('Webhook registration candidates are not fully prepared')
  }

  const newerRows = await tx
    .select({ id: webhook.id })
    .from(webhook)
    .where(
      and(
        eq(webhook.workflowId, fence.workflowId),
        inArray(webhook.registrationStatus, ['active', 'candidate']),
        gt(webhook.registrationGeneration, fence.generation)
      )
    )
    .limit(1)
  if (newerRows.length > 0) throw new StaleWebhookRegistrationOperationError()

  const now = new Date()
  await tx
    .update(webhook)
    .set({
      registrationStatus: 'retired',
      isActive: false,
      archivedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(webhook.workflowId, fence.workflowId),
        eq(webhook.registrationStatus, 'active'),
        lt(webhook.registrationGeneration, fence.generation)
      )
    )

  await tx
    .update(webhook)
    .set({
      deploymentVersionId: fence.deploymentVersionId,
      isActive: true,
      archivedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(webhook.workflowId, fence.workflowId),
        eq(webhook.registrationStatus, 'active'),
        eq(webhook.registrationGeneration, fence.generation)
      )
    )

  await tx
    .update(webhook)
    .set({
      registrationStatus: 'active',
      deploymentVersionId: fence.deploymentVersionId,
      isActive: true,
      archivedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(webhook.workflowId, fence.workflowId),
        eq(webhook.registrationStatus, 'candidate'),
        eq(webhook.registrationGeneration, fence.generation)
      )
    )
}

/** Lists retired rows only while the supplied activation is still the current generation. */
export async function listRetiredWebhookRegistrationsForCleanup(
  input: WebhookRegistrationOperationFence & { limit?: number }
): Promise<WebhookRegistrationRow[]> {
  return db.transaction(async (tx) => {
    await assertCurrentOperation(tx, input, ['active'])
    return tx
      .select()
      .from(webhook)
      .where(
        and(
          eq(webhook.workflowId, input.workflowId),
          eq(webhook.registrationStatus, 'retired'),
          lt(webhook.registrationGeneration, input.generation)
        )
      )
      .orderBy(webhook.registrationGeneration, webhook.id)
      .limit(input.limit ?? 100)
  })
}

/**
 * Reloads an exact cleanup snapshot. A row advanced or reused by a newer generation is rejected.
 */
export async function getWebhookCleanupSnapshotIfCurrent(input: {
  workflowId: string
  webhookId: string
  expectedGeneration: number
  statuses: readonly WebhookRegistrationStatus[]
}): Promise<WebhookRegistrationRow | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(webhook)
      .where(
        and(
          eq(webhook.workflowId, input.workflowId),
          eq(webhook.id, input.webhookId),
          eq(webhook.registrationGeneration, input.expectedGeneration),
          inArray(webhook.registrationStatus, input.statuses)
        )
      )
      .for('update')
    return row ?? null
  })
}

/** Deletes an externally cleaned row while preserving sticky path ownership. */
export async function deleteWebhookRegistrationAfterCleanup(input: {
  workflowId: string
  webhookId: string
  expectedGeneration: number
  statuses: readonly WebhookRegistrationStatus[]
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(webhook)
      .where(
        and(
          eq(webhook.workflowId, input.workflowId),
          eq(webhook.id, input.webhookId),
          eq(webhook.registrationGeneration, input.expectedGeneration),
          inArray(webhook.registrationStatus, input.statuses)
        )
      )
      .returning({ id: webhook.id })
    return Boolean(deleted)
  })
}
