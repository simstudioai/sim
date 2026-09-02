import { db } from '@sim/db'
import { document, knowledgeConnector, knowledgeConnectorMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { generateRequestId } from '@/lib/core/utils/request'
import { loadCredentialGroupCredentialListContext } from '@/lib/credential-groups/credentials'
import { EMPTY_ACL, WORKSPACE_ACL } from '@/lib/knowledge/access/tokens'
import {
  grantKnowledgeConnectorCredentialAccess,
  revokeKnowledgeConnectorCredentialAccess,
  validateKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/connectors/member-access'
import {
  type ConnectorWithoutSecret,
  getKnowledgeConnector,
  type KnowledgeConnectorRow,
} from '@/lib/knowledge/orchestration/connectors'
import {
  classifyKnowledgeFailure,
  fail,
  type KnowledgeOperationContext,
  type KnowledgeOrchestrationResult,
} from '@/lib/knowledge/orchestration/shared'
import type { ConnectorMeta } from '@/connectors/types'

const logger = createLogger('KnowledgeConnectorAccessOrchestration')

/** Documents rewritten per statement while switching modes. */
const ACCESS_REWRITE_BATCH_SIZE = 1000
/** Wall-clock the request spends rewriting before handing the rest to the member run. */
const ACCESS_REWRITE_REQUEST_BUDGET_MS = 20_000
/** Connector statuses a switch may start from; a running or queued sync owns the row. */
const SWITCHABLE_CONNECTOR_STATUSES = ['active', 'error', 'paused'] as const

async function loadDispatchSync() {
  return (await import('@/lib/knowledge/connectors/queue')).dispatchSync
}

async function loadDispatchMemberSync() {
  return (await import('@/lib/knowledge/connectors/member-queue')).dispatchMemberSync
}

/** The credential-group binding a members-mode connector needs, as the caller supplied it. */
export interface KnowledgeConnectorMembersBinding {
  credentialGroupId: string
  credentialGroupOptionId: string
}

export interface ResolvedMembersBinding extends KnowledgeConnectorMembersBinding {
  workspaceId: string
}

/**
 * Checks a members-mode binding against the group, the option, and the
 * connector, before any row is touched. Shared by creation and by the mode
 * switch, so both refuse exactly the same bindings.
 */
export async function resolveKnowledgeConnectorMembersBinding(input: {
  workspaceId: string
  connectorMeta: Pick<ConnectorMeta, 'name' | 'auth' | 'permissionScopedListing' | 'configFields'>
  binding: KnowledgeConnectorMembersBinding
  sourceConfig: Record<string, unknown>
}): Promise<ResolvedMembersBinding> {
  const group = await loadCredentialGroupCredentialListContext(input.binding.credentialGroupId)
  if (!group || group.workspaceId !== input.workspaceId) {
    throw new OrchestrationError('validation', 'Credential Group was not found in this workspace')
  }
  const validation = validateKnowledgeConnectorMembersBinding({
    connectorMeta: input.connectorMeta,
    group,
    credentialGroupOptionId: input.binding.credentialGroupOptionId,
    sourceConfig: input.sourceConfig,
  })
  if (!validation.ok) throw new OrchestrationError('validation', validation.message)
  return { ...input.binding, workspaceId: input.workspaceId }
}

/**
 * Rewrites the connector's document ACLs to `target` in bounded batches until
 * done or the budget runs out. Returns whether every row was rewritten.
 */
async function rewriteConnectorAcls(
  connectorId: string,
  target: readonly string[],
  deadlineAt: number
): Promise<boolean> {
  const targetArray = sql`ARRAY[${sql.join(
    target.map((token) => sql`${token}`),
    sql`, `
  )}]::text[]`
  const mismatch =
    target.length === 0
      ? sql`cardinality(${document.acl}) > 0`
      : sql`${document.acl} <> ${targetArray}`
  for (;;) {
    const rewritten = await db
      .update(document)
      .set({ acl: [...target] })
      .where(
        eq(
          document.id,
          sql`ANY(ARRAY(
            SELECT ${document.id} FROM ${document}
            WHERE ${document.connectorId} = ${connectorId} AND ${mismatch}
            LIMIT ${ACCESS_REWRITE_BATCH_SIZE}
          ))`
        )
      )
      .returning({ id: document.id })
    if (rewritten.length < ACCESS_REWRITE_BATCH_SIZE) return true
    if (Date.now() >= deadlineAt) return false
  }
}

/**
 * Takes the connector's content lease for the switch, so no sync of either
 * engine can start while documents are being rewritten. Returns the row as it
 * was, or null when a sync already owns it.
 */
async function acquireSwitchLease(
  connectorId: string,
  knowledgeBaseId: string,
  switchId: string,
  expectedStatus: string
): Promise<KnowledgeConnectorRow | null> {
  const now = new Date()
  const [row] = await db
    .update(knowledgeConnector)
    .set({ status: 'syncing', syncLockToken: switchId, syncLockLeaseAt: now, updatedAt: now })
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
        inArray(knowledgeConnector.status, SWITCHABLE_CONNECTOR_STATUSES),
        eq(knowledgeConnector.status, expectedStatus),
        inArray(knowledgeConnector.memberSyncStatus, ['idle', 'error', 'disabled']),
        isNull(knowledgeConnector.syncLockToken),
        isNull(knowledgeConnector.memberSyncLockToken),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .returning()
  return row ?? null
}

function switchLeaseHeld(connectorId: string, switchId: string) {
  return and(
    eq(knowledgeConnector.id, connectorId),
    eq(knowledgeConnector.status, 'syncing'),
    eq(knowledgeConnector.syncLockToken, switchId)
  )
}

/** Releases a switch that could not complete, restoring the status it found. */
async function releaseSwitchLease(
  connectorId: string,
  switchId: string,
  previousStatus: string
): Promise<void> {
  await db
    .update(knowledgeConnector)
    .set({
      status: previousStatus,
      syncLockToken: null,
      syncLockLeaseAt: null,
      updatedAt: new Date(),
    })
    .where(switchLeaseHeld(connectorId, switchId))
}

export interface PerformUpdateKnowledgeConnectorAccessParams extends KnowledgeOperationContext {
  knowledgeBase: { id: string; name: string; workspaceId: string }
  connectorId: string
  target:
    | { accessMode: 'members'; binding: ResolvedMembersBinding }
    | { accessMode: 'workspace'; credentialId: string }
  resolveBillingAttribution: () => Promise<BillingAttributionSnapshot>
}

export type PerformUpdateKnowledgeConnectorAccessResult = KnowledgeOrchestrationResult<{
  connector: ConnectorWithoutSecret
  /** Whether the switch changed anything; a repeat of the current binding is a no-op. */
  changed: boolean
}>

/**
 * Moves a connector between access modes: rewrite the documents' ACLs to the
 * new mode's default, then flip the mode, all under the connector's content
 * lease so neither engine runs against a half-rewritten corpus. A rewrite that
 * outgrows the request budget is left for the member run to finish before the
 * mode takes effect (`accessRewritePending`); documents are only ever hidden
 * early, never shown early.
 */
export async function performUpdateKnowledgeConnectorAccess(
  params: PerformUpdateKnowledgeConnectorAccessParams
): Promise<PerformUpdateKnowledgeConnectorAccessResult> {
  const { knowledgeBase: kb, connectorId, target } = params
  const requestId = params.requestId ?? generateRequestId()

  const existing = await getKnowledgeConnector(kb.id, connectorId)
  if (!existing) return fail('Connector not found', 'not_found')

  const unchanged =
    target.accessMode === existing.accessMode &&
    (target.accessMode === 'workspace'
      ? target.credentialId === existing.credentialId
      : target.binding.credentialGroupId === existing.credentialGroupId &&
        target.binding.credentialGroupOptionId === existing.credentialGroupOptionId)
  if (unchanged) {
    const { encryptedApiKey: _secret, ...connector } = existing
    return { success: true, connector, changed: false }
  }

  const switchId = generateId()
  /**
   * The status to restore is the one the row had before the lease, which the
   * lease itself asserts: a row returned by the lease update already reads
   * `syncing`, and a status that moved between the read and the lease makes
   * the lease fail rather than be restored wrongly.
   */
  const previousStatus = existing.status === 'pending' ? 'active' : existing.status
  const leased = await acquireSwitchLease(connectorId, kb.id, switchId, existing.status)
  if (!leased) return fail('Sync already in progress', 'conflict')
  const deadlineAt = Date.now() + ACCESS_REWRITE_REQUEST_BUDGET_MS

  try {
    if (target.accessMode === 'members') {
      const rewritten = await rewriteConnectorAcls(connectorId, EMPTY_ACL, deadlineAt)
      await grantKnowledgeConnectorCredentialAccess(
        {
          workspaceId: kb.workspaceId,
          credentialGroupId: target.binding.credentialGroupId,
          credentialGroupOptionId: target.binding.credentialGroupOptionId,
          connectorId,
        },
        params.userId
      )
      if (
        existing.credentialGroupId &&
        existing.credentialGroupId !== target.binding.credentialGroupId
      ) {
        await revokeKnowledgeConnectorCredentialAccess(
          {
            workspaceId: kb.workspaceId,
            credentialGroupId: existing.credentialGroupId,
            connectorId,
          },
          params.userId
        )
      }
      const now = new Date()
      const [updated] = await db
        .update(knowledgeConnector)
        .set({
          accessMode: 'members',
          credentialId: null,
          credentialGroupId: target.binding.credentialGroupId,
          credentialGroupOptionId: target.binding.credentialGroupOptionId,
          accessRewritePending: !rewritten,
          memberSyncStatus: 'idle',
          memberSyncConsecutiveFailures: 0,
          lastMemberSyncError: null,
          nextMemberSyncAt: now,
          nextSyncAt: null,
          status: previousStatus,
          syncLockToken: null,
          syncLockLeaseAt: null,
          updatedAt: now,
        })
        .where(switchLeaseHeld(connectorId, switchId))
        .returning()
      if (!updated)
        return fail('Connector changed during the switch; retry the request', 'conflict')
      logger.info(`[${requestId}] Switched connector ${connectorId} to members mode`, {
        rewritten,
      })
      const { encryptedApiKey: _secret, ...connector } = updated
      if (previousStatus !== 'paused') {
        await dispatchMemberSyncBestEffort(connectorId, params, requestId, now)
      }
      return { success: true, connector, changed: true }
    }

    await db
      .delete(knowledgeConnectorMember)
      .where(eq(knowledgeConnectorMember.connectorId, connectorId))
    const rewritten = await rewriteConnectorAcls(connectorId, WORKSPACE_ACL, deadlineAt)
    if (existing.credentialGroupId) {
      await revokeKnowledgeConnectorCredentialAccess(
        { workspaceId: kb.workspaceId, credentialGroupId: existing.credentialGroupId, connectorId },
        params.userId
      )
    }
    const now = new Date()
    const [updated] = await db
      .update(knowledgeConnector)
      .set({
        accessMode: 'workspace',
        credentialId: target.credentialId,
        credentialGroupId: null,
        credentialGroupOptionId: null,
        /** The content engine restores workspace access on completion; no member run will. */
        accessRewritePending: false,
        memberSyncStatus: 'idle',
        memberSyncConsecutiveFailures: 0,
        lastMemberSyncError: null,
        nextMemberSyncAt: null,
        nextSyncAt: now,
        status: previousStatus,
        syncLockToken: null,
        syncLockLeaseAt: null,
        updatedAt: now,
      })
      .where(switchLeaseHeld(connectorId, switchId))
      .returning()
    if (!updated) return fail('Connector changed during the switch; retry the request', 'conflict')
    logger.info(`[${requestId}] Switched connector ${connectorId} to workspace mode`, {
      rewritten,
    })
    const { encryptedApiKey: _secret, ...connector } = updated
    if (previousStatus !== 'paused') {
      await dispatchContentSyncBestEffort(connectorId, params, requestId, now)
    }
    return { success: true, connector, changed: true }
  } catch (error) {
    await releaseSwitchLease(connectorId, switchId, previousStatus).catch((releaseError) => {
      logger.error(`[${requestId}] Failed to release the access switch lease`, {
        connectorId,
        error: releaseError,
      })
    })
    return classifyKnowledgeFailure(
      error,
      requestId,
      `Switch access mode of connector ${connectorId}`
    )
  }
}

async function dispatchMemberSyncBestEffort(
  connectorId: string,
  params: PerformUpdateKnowledgeConnectorAccessParams,
  requestId: string,
  expectedNextMemberSyncAt: Date
): Promise<void> {
  try {
    const dispatchMemberSync = await loadDispatchMemberSync()
    const dispatch = await dispatchMemberSync(connectorId, {
      billingAttribution: await params.resolveBillingAttribution(),
      expectedNextMemberSyncAt,
      requestId,
      requireRunnable: true,
    })
    if (!dispatch.queued) {
      logger.warn(`[${requestId}] Member sync after the switch was not queued: ${dispatch.reason}`)
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to dispatch the member sync after the switch`, {
      connectorId,
      error,
    })
  }
}

async function dispatchContentSyncBestEffort(
  connectorId: string,
  params: PerformUpdateKnowledgeConnectorAccessParams,
  requestId: string,
  expectedNextSyncAt: Date
): Promise<void> {
  try {
    const dispatchSync = await loadDispatchSync()
    const dispatch = await dispatchSync(connectorId, {
      billingAttribution: await params.resolveBillingAttribution(),
      expectedNextSyncAt,
      requestId,
      requireRunnable: true,
    })
    if (!dispatch.queued) {
      logger.warn(`[${requestId}] Sync after the switch was not queued: ${dispatch.reason}`)
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to dispatch the sync after the switch`, {
      connectorId,
      error,
    })
  }
}
