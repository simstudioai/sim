import { db } from '@sim/db'
import { knowledgeConnector, knowledgeConnectorMember } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  resourceScopeFields,
  resourceScopeFromOwner,
  sameResourceScope,
} from '@/lib/core/resource-scope'
import { generateRequestId } from '@/lib/core/utils/request'
import { loadScopedAccountsCredentialListContext } from '@/lib/credential-groups/credentials'
import { requireKnowledgeMemberAccessAvailable } from '@/lib/knowledge/access/availability'
import { EMPTY_ACL, WORKSPACE_ACL } from '@/lib/knowledge/access/tokens'
import { aclIsDerived, type ContentEngineAccessMode } from '@/lib/knowledge/connectors/access-modes'
import {
  grantKnowledgeConnectorCredentialAccess,
  revokeKnowledgeConnectorCredentialAccess,
  stripListingCapFields,
  validateKnowledgeConnectorMembersBinding,
} from '@/lib/knowledge/connectors/member-access'
import { rewriteConnectorAcls } from '@/lib/knowledge/connectors/member-observations'
import { provisionKnowledgeConnectorMembersBinding } from '@/lib/knowledge/connectors/member-provisioning'
import {
  type ConnectorMembersBinding,
  type ConnectorWithoutSecret,
  getKnowledgeConnector,
  type KnowledgeConnectorRow,
  lockCredentialGroupOption,
} from '@/lib/knowledge/orchestration/connectors'
import {
  classifyKnowledgeFailure,
  fail,
  type KnowledgeOperationContext,
  type KnowledgeOrchestrationResult,
} from '@/lib/knowledge/orchestration/shared'
import type { ConnectorMeta } from '@/connectors/types'

const logger = createLogger('KnowledgeConnectorAccessOrchestration')

/** The switch lease was taken away between acquiring it and writing the flip. */
class SwitchLeaseLostError extends Error {
  constructor() {
    super('Connector changed during the switch')
    this.name = 'SwitchLeaseLostError'
  }
}

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

export interface ResolvedMembersBinding extends ConnectorMembersBinding {
  /** The connector's source config with the listing caps cleared, which members mode stores. */
  sourceConfig: Record<string, unknown>
}

/**
 * Checks a members-mode binding against the group, the option, and the
 * connector, before any row is touched. Shared by creation and by the mode
 * switch, so both refuse exactly the same bindings.
 */
export async function resolveKnowledgeConnectorMembersBinding(input: {
  workspaceId?: string
  organizationId?: string
  connectorMeta: Pick<ConnectorMeta, 'name' | 'auth' | 'permissionScopedListing' | 'configFields'>
  /** The admin acting, recorded as the creator of a provisioned group. */
  actingUserId: string
  sourceConfig: Record<string, unknown>
}): Promise<ResolvedMembersBinding> {
  /**
   * Judged by the workspace alone, as the member engine is: a person's own
   * flag clause must not open a mode the engine will then refuse to run.
   */
  await requireKnowledgeMemberAccessAvailable(resourceScopeFields(resourceScopeFromOwner(input)))
  if (!input.connectorMeta.permissionScopedListing) {
    throw new OrchestrationError(
      'validation',
      `${input.connectorMeta.name} cannot sync per member: its listing does not reflect who may read each document`
    )
  }
  const sourceConfig = stripListingCapFields(input.connectorMeta, input.sourceConfig)
  const binding = await provisionKnowledgeConnectorMembersBinding({
    ...resourceScopeFields(resourceScopeFromOwner(input)),
    connectorMeta: input.connectorMeta,
    userId: input.actingUserId,
  })
  const group = await loadScopedAccountsCredentialListContext(resourceScopeFromOwner(input))
  if (
    !group ||
    group.credentialGroupId !== binding.credentialGroupId ||
    !sameResourceScope(resourceScopeFromOwner(group), resourceScopeFromOwner(input))
  ) {
    throw new OrchestrationError('validation', 'Credential Group was not found in this workspace')
  }
  const validation = validateKnowledgeConnectorMembersBinding({
    connectorMeta: input.connectorMeta,
    group,
    credentialGroupOptionId: binding.credentialGroupOptionId,
    sourceConfig,
  })
  if (!validation.ok) throw new OrchestrationError('validation', validation.message)
  return { ...binding, sourceConfig }
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

/**
 * Hands the lease back, restoring the status the switch found, along with any
 * last values the switch writes as it ends. Returns the row as released, or
 * null when the lease had already been taken away.
 */
async function releaseSwitchLease(
  connectorId: string,
  switchId: string,
  previousStatus: string,
  values: Partial<typeof knowledgeConnector.$inferInsert> = {}
): Promise<KnowledgeConnectorRow | null> {
  const [row] = await db
    .update(knowledgeConnector)
    .set({
      ...values,
      status: previousStatus,
      syncLockToken: null,
      syncLockLeaseAt: null,
      updatedAt: new Date(),
    })
    .where(switchLeaseHeld(connectorId, switchId))
    .returning()
  return row ?? null
}

/**
 * The mode a connector is being moved into, with what that mode needs to run:
 * a Credential Group binding for `members`, a stored credential for the modes
 * that sync as one.
 */
export type ConnectorAccessTarget =
  | { accessMode: 'members'; binding: ResolvedMembersBinding; credentialId?: string | null }
  | { accessMode: ContentEngineAccessMode; credentialId: string | null }

export interface PerformUpdateKnowledgeConnectorAccessParams extends KnowledgeOperationContext {
  knowledgeBase: { id: string; name: string; workspaceId?: string; organizationId?: string }
  connectorId: string
  target: ConnectorAccessTarget
  resolveBillingAttribution: () => Promise<BillingAttributionSnapshot>
}

export type PerformUpdateKnowledgeConnectorAccessResult = KnowledgeOrchestrationResult<{
  connector: ConnectorWithoutSecret
  /** Whether the switch changed anything; a repeat of the current binding is a no-op. */
  changed: boolean
}>

/**
 * Moves a connector between access modes under the connector's content lease,
 * so neither engine runs against a half-rewritten corpus.
 *
 * Into members mode: grant the option's credentials first (a reversible policy
 * write), rewrite every ACL to nobody, flip under the Credential Group's row
 * lock, then revoke the previous group's grant and release. A rewrite that
 * outgrows the request budget is finished by the first member run before it
 * lists (`accessRewritePending`); documents are hidden early, never shown
 * early.
 *
 * Back to workspace mode: drop the members and flip in one transaction with
 * the rewrite marked pending, rewrite every ACL to the workspace while the
 * lease is still held, then revoke the grant and release. A rewrite that
 * outgrows the budget, or is interrupted, is finished by the next content
 * sync (`accessRewritePending`); documents are hidden until then.
 *
 * Either way the lease outlives the revoke. A revoke drops the connector from
 * every option of the group, so releasing first would let a switch that has
 * just re-granted the same group lose its grant to this one's cleanup.
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
    (target.accessMode === 'members'
      ? target.binding.credentialGroupOptionId === existing.credentialGroupOptionId &&
        (target.credentialId ?? null) === existing.credentialId
      : target.credentialId === existing.credentialId)
  if (unchanged) {
    /**
     * Re-applying the current binding on a connector whose member sync was
     * disabled is how it is re-enabled: the next run reconciles members from
     * the group again and restores access from the retained observations.
     */
    if (target.accessMode === 'members' && existing.memberSyncStatus === 'disabled') {
      const now = new Date()
      const [updated] = await db
        .update(knowledgeConnector)
        .set({
          memberSyncStatus: 'idle',
          memberSyncConsecutiveFailures: 0,
          lastMemberSyncError: null,
          nextMemberSyncAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            eq(knowledgeConnector.memberSyncStatus, 'disabled'),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .returning()
      if (!updated) return fail('Connector changed; retry the request', 'conflict')
      logger.info(`[${requestId}] Re-enabled member sync on connector ${connectorId}`)
      const { encryptedApiKey: _secret, ...connector } = updated
      if (updated.status !== 'paused') {
        await dispatchMemberSyncBestEffort(connectorId, params, requestId, now)
      }
      return { success: true, connector, changed: true }
    }
    const { encryptedApiKey: _secret, ...connector } = existing
    return { success: true, connector, changed: false }
  }

  /**
   * Staying in the same credential-backed mode with a different credential
   * moves no document's visibility, so the lease is not taken. It does change
   * what the source shows: the new credential may see a different corpus, and
   * only a full listing reconciles that, so the incremental watermark is
   * dropped and a sync queued unless the source is paused or disabled. The
   * write refuses while a sync owns the row, whose terminal write would
   * otherwise put the watermark straight back.
   */
  if (target.accessMode !== 'members' && target.accessMode === existing.accessMode) {
    const now = new Date()
    const [updated] = await db
      .update(knowledgeConnector)
      .set({
        credentialId: target.credentialId,
        lastSyncAt: null,
        listingCheckpoint: null,
        directoryCheckpoint: null,
        nextSyncAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(knowledgeConnector.id, connectorId),
          eq(knowledgeConnector.knowledgeBaseId, kb.id),
          inArray(knowledgeConnector.status, [...SWITCHABLE_CONNECTOR_STATUSES, 'disabled']),
          eq(knowledgeConnector.status, existing.status),
          isNull(knowledgeConnector.syncLockToken),
          isNull(knowledgeConnector.archivedAt),
          isNull(knowledgeConnector.deletedAt)
        )
      )
      .returning()
    if (!updated) {
      const current = await getKnowledgeConnector(kb.id, connectorId)
      return current
        ? fail('Sync already in progress', 'conflict')
        : fail('Connector not found', 'not_found')
    }
    logger.info(`[${requestId}] Changed the credential of connector ${connectorId}`)
    const { encryptedApiKey: _secret, ...connector } = updated
    if (existing.status !== 'paused' && existing.status !== 'disabled') {
      await dispatchContentSyncBestEffort(connectorId, params, requestId, now)
    }
    return { success: true, connector, changed: true }
  }

  const switchId = generateId()
  /**
   * The status to restore is the one the row had before the lease, which the
   * lease itself asserts: a status that moved between the read and the lease
   * makes the lease fail rather than be restored wrongly.
   */
  const previousStatus = existing.status
  const leased = await acquireSwitchLease(connectorId, kb.id, switchId, existing.status)
  if (!leased) return fail('Sync already in progress', 'conflict')
  const deadlineAt = Date.now() + ACCESS_REWRITE_REQUEST_BUDGET_MS

  try {
    if (target.accessMode === 'members') {
      if (kb.workspaceId)
        await grantKnowledgeConnectorCredentialAccess(
          {
            workspaceId: kb.workspaceId,
            credentialGroupId: target.binding.credentialGroupId,
            credentialGroupOptionId: target.binding.credentialGroupOptionId,
            connectorId,
          },
          params.userId
        )
      try {
        const rewritten = await rewriteConnectorAcls(connectorId, EMPTY_ACL, {
          deadlineAt: deadlineAt,
          lease: { stillHeld: () => switchLeaseHeld(connectorId, switchId) },
        })
        /**
         * The flip lands under the group's row lock, which the group's option
         * edits and delete hold while they look for connectors bound to what
         * they remove: an option gone by the time the lock is ours refuses the
         * flip, and one removed after it finds this row.
         */
        const flippedAt = new Date()
        await db.transaction(async (tx) => {
          await lockCredentialGroupOption(tx, {
            ...resourceScopeFields(resourceScopeFromOwner(kb)),
            credentialGroupId: target.binding.credentialGroupId,
            credentialGroupOptionId: target.binding.credentialGroupOptionId,
          })
          const [row] = await tx
            .update(knowledgeConnector)
            .set({
              accessMode: 'members',
              credentialId: target.credentialId ?? null,
              lastSyncAt: null,
              listingCheckpoint: null,
              directoryCheckpoint: null,
              credentialGroupId: target.binding.credentialGroupId,
              credentialGroupOptionId: target.binding.credentialGroupOptionId,
              sourceConfig: target.binding.sourceConfig,
              accessRewritePending: !rewritten,
              memberSyncStatus: 'idle',
              memberSyncConsecutiveFailures: 0,
              lastMemberSyncError: null,
              nextMemberSyncAt: flippedAt,
              nextSyncAt: null,
              updatedAt: flippedAt,
            })
            .where(switchLeaseHeld(connectorId, switchId))
            .returning({ id: knowledgeConnector.id })
          if (!row) throw new SwitchLeaseLostError()
        })
        const updated = await releaseSwitchLease(connectorId, switchId, previousStatus)
        if (!updated) throw new SwitchLeaseLostError()
        logger.info(`[${requestId}] Switched connector ${connectorId} to members mode`, {
          rewritten,
        })
        const { encryptedApiKey: _secret, ...connector } = updated
        if (previousStatus !== 'paused') {
          await dispatchMemberSyncBestEffort(connectorId, params, requestId, flippedAt)
        }
        return { success: true, connector, changed: true }
      } catch (error) {
        /**
         * The grant is the one write a failed switch must not leave behind. A
         * grant replaces the connector's option within the group, so a failed
         * move between options of one group puts the previous option back
         * rather than leaving the connector on none.
         */
        const previousOptionId = existing.credentialGroupOptionId
        if (kb.workspaceId)
          await (previousOptionId
            ? grantKnowledgeConnectorCredentialAccess(
                {
                  workspaceId: kb.workspaceId,
                  credentialGroupId: target.binding.credentialGroupId,
                  credentialGroupOptionId: previousOptionId,
                  connectorId,
                },
                params.userId
              )
            : revokeKnowledgeConnectorCredentialAccess(
                {
                  workspaceId: kb.workspaceId,
                  credentialGroupId: target.binding.credentialGroupId,
                  connectorId,
                },
                params.userId
              )
          ).catch((undoError) => {
            logger.error(`[${requestId}] Failed to undo the grant of an abandoned switch`, {
              connectorId,
              error: getErrorMessage(undoError),
            })
          })
        throw error
      }
    }

    /**
     * Entering a mode whose ACL is derived (admin) hides every document, and
     * does so *before* the flip, as the members path does: an interruption
     * leaves the connector in the mode it came from with some documents
     * hidden, which that mode's next run restores. Entering workspace mode
     * publishes every document, and does so *after* the flip, so no document
     * is shown under the mode it is leaving. Either way, documents are hidden
     * until the rewrite lands, never shown under the wrong mode, and a rewrite
     * that outgrows the request budget is marked pending for the content
     * engine to finish before it lists anything. A derived-ACL mode also has
     * no listing cap, so the flip clears them.
     */
    const hidesOnEntry = aclIsDerived(target.accessMode)
    const rewriteEntryAcls = () =>
      rewriteConnectorAcls(connectorId, hidesOnEntry ? EMPTY_ACL : WORKSPACE_ACL, {
        deadlineAt: deadlineAt,
        lease: { stillHeld: () => switchLeaseHeld(connectorId, switchId) },
      })
    let rewritten = false
    if (hidesOnEntry) rewritten = await rewriteEntryAcls()
    const { CONNECTOR_META_REGISTRY } = await import('@/connectors/registry')
    const connectorMeta = CONNECTOR_META_REGISTRY[existing.connectorType]
    const flippedAt = new Date()
    await db.transaction(async (tx) => {
      await tx
        .delete(knowledgeConnectorMember)
        .where(eq(knowledgeConnectorMember.connectorId, connectorId))
      const [row] = await tx
        .update(knowledgeConnector)
        .set({
          accessMode: target.accessMode,
          credentialId: target.credentialId,
          credentialGroupId: null,
          credentialGroupOptionId: null,
          ...(hidesOnEntry && connectorMeta
            ? {
                sourceConfig: stripListingCapFields(
                  connectorMeta,
                  existing.sourceConfig as Record<string, unknown>
                ),
              }
            : {}),
          accessRewritePending: !rewritten,
          /**
           * The next content sync must list everything and reconcile: the
           * union of every member's documents may hold documents the
           * workspace credential cannot see, and only a full listing removes
           * them.
           */
          lastSyncAt: null,
          listingCheckpoint: null,
          directoryCheckpoint: null,
          memberSyncStatus: 'idle',
          memberSyncConsecutiveFailures: 0,
          lastMemberSyncError: null,
          nextMemberSyncAt: null,
          nextSyncAt: flippedAt,
          updatedAt: flippedAt,
        })
        .where(switchLeaseHeld(connectorId, switchId))
        .returning({ id: knowledgeConnector.id })
      if (!row) throw new SwitchLeaseLostError()
    })
    if (!hidesOnEntry) rewritten = await rewriteEntryAcls()
    if (existing.credentialGroupId && kb.workspaceId) {
      await revokeKnowledgeConnectorCredentialAccess(
        {
          workspaceId: kb.workspaceId,
          credentialGroupId: existing.credentialGroupId,
          connectorId,
        },
        params.userId
      ).catch((error) => {
        logger.error(`[${requestId}] Failed to revoke the grant after leaving members mode`, {
          connectorId,
          error: getErrorMessage(error),
        })
      })
    }
    const updated = await releaseSwitchLease(connectorId, switchId, previousStatus, {
      accessRewritePending: !rewritten,
    })
    if (!updated) throw new SwitchLeaseLostError()
    logger.info(`[${requestId}] Switched connector ${connectorId} to ${target.accessMode} mode`, {
      rewritten,
    })
    const { encryptedApiKey: _secret, ...connector } = updated
    if (previousStatus !== 'paused') {
      /** The dispatch asserts the schedule the flip wrote, not a later clock read. */
      await dispatchContentSyncBestEffort(connectorId, params, requestId, flippedAt)
    }
    return { success: true, connector, changed: true }
  } catch (error) {
    if (error instanceof SwitchLeaseLostError) {
      /** The flip may already have landed; a reaped lease means the content engine now owns the rest. */
      return fail('Connector changed during the switch; retry the request', 'conflict')
    }
    await releaseSwitchLease(connectorId, switchId, previousStatus).catch((releaseError) => {
      logger.error(`[${requestId}] Failed to release the access switch lease`, {
        connectorId,
        error: releaseError,
      })
      return null
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
