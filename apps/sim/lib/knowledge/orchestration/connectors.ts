import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import {
  credentialGroup,
  document,
  embedding,
  knowledgeBase,
  knowledgeBaseTagDefinitions,
  knowledgeConnector,
  knowledgeConnectorMember,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId } from '@sim/utils/id'
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import { encryptApiKey } from '@/lib/api-key/crypto'
import type { BillingAttributionSnapshot } from '@/lib/billing/core/billing-attribution'
import {
  hasWorkspaceLiveSyncAccess,
  isOrganizationOnEnterprisePlan,
} from '@/lib/billing/core/subscription'
import {
  incrementStorageUsageForBillingContextInTx,
  maybeNotifyStorageLimitForBillingContext,
  resolveStorageBillingContext,
  type StorageBillingContext,
} from '@/lib/billing/storage'
import { OrchestrationError, type OrchestrationErrorCode } from '@/lib/core/orchestration/types'
import {
  type ResourceOwner,
  type ResourceScope,
  resourceScopeFields,
  resourceScopeFromOwner,
} from '@/lib/core/resource-scope'
import { resourceScopeCondition } from '@/lib/core/resource-scope.server'
import { generateRequestId } from '@/lib/core/utils/request'
import type { DbOrTx } from '@/lib/db/types'
import {
  aclIsDerived,
  type ConnectorAccessMode,
  effectiveConnectorSyncIntervalMinutes,
  isContentEngineAccessMode,
} from '@/lib/knowledge/connectors/access-modes'
import {
  type ConnectorAccessToken,
  syncContextForToken,
} from '@/lib/knowledge/connectors/access-token'
import {
  findListingCapViolation,
  grantKnowledgeConnectorCredentialAccess,
  revokeKnowledgeConnectorCredentialAccess,
  stripListingCapFields,
} from '@/lib/knowledge/connectors/member-access'
import { allocateTagSlots } from '@/lib/knowledge/constants'
import { enqueueKnowledgeStorageCleanup } from '@/lib/knowledge/documents/storage-cleanup'
import {
  auditActorFields,
  classifyKnowledgeFailure,
  fail,
  type KnowledgeOperationContext,
  type KnowledgeOrchestrationResult,
} from '@/lib/knowledge/orchestration/shared'
import { cleanupUnusedTagDefinitions, createTagDefinition } from '@/lib/knowledge/tags/service'
import { captureServerEvent } from '@/lib/posthog/server'
import { searchSourceIdentity } from '@/lib/sim-search/source-identity'
import { getConnectorApiKeyConfig } from '@/connectors/auth'
import { PER_MEMBER_LISTING_CONTEXT } from '@/connectors/utils'

const logger = createLogger('KnowledgeConnectorOrchestration')

/**
 * The connector registry and the sync queue are loaded on demand rather than
 * imported at module scope. Both pull in every connector's SDK and the whole
 * sync engine, and this module is re-exported from the knowledge orchestration
 * barrel — a static edge would drag that graph into the bundle of every route
 * that merely creates a knowledge base or uploads a document.
 */
async function loadDispatchSync() {
  return (await import('@/lib/knowledge/connectors/queue')).dispatchSync
}

async function loadDispatchMemberSync() {
  return (await import('@/lib/knowledge/connectors/member-queue')).dispatchMemberSync
}

/** The Credential Group option a members-mode connector crawls with, already validated by the caller. */
export interface ConnectorMembersBinding {
  credentialGroupId: string
  credentialGroupOptionId: string
}

/**
 * Locks the Credential Group's row for the rest of the transaction and confirms
 * the option is still part of it. The group's option edits and delete take the
 * same row lock and refuse while a connector row is bound to what they remove,
 * so a binding written under this lock is serialized against them: it either
 * finds the option gone, or lands before the removal looks for it. The grant
 * itself is a policy write with its own revision CAS, which is why the row
 * write, not the grant, is what takes the lock.
 */
export async function lockCredentialGroupOption(
  tx: DbOrTx,
  binding: ConnectorMembersBinding & ResourceOwner
): Promise<void> {
  const [group] = await tx
    .select({ options: credentialGroup.options })
    .from(credentialGroup)
    .where(
      and(
        eq(credentialGroup.id, binding.credentialGroupId),
        resourceScopeCondition(credentialGroup, resourceScopeFromOwner(binding))
      )
    )
    .limit(1)
    .for('update')
  if (!group) {
    throw new OrchestrationError('validation', 'Credential Group was not found in this workspace')
  }
  if (!group.options.some((option) => option.id === binding.credentialGroupOptionId)) {
    throw new OrchestrationError(
      'validation',
      'Credential option was not found in this Credential Group'
    )
  }
}

/** A connector row exactly as stored, including its encrypted API key. */
export type KnowledgeConnectorRow = typeof knowledgeConnector.$inferSelect
type ConnectorRow = KnowledgeConnectorRow
/** The connector row as it reaches every caller: never carrying the stored API key. */
export type ConnectorWithoutSecret = Omit<ConnectorRow, 'encryptedApiKey'>

/** A refused `sourceConfig`, with the failure class the caller wants surfaced. */
export interface SourceConfigRejection {
  message: string
  errorCode: OrchestrationErrorCode
}

/** The knowledge base a connector operation targets, already authorized by the caller. */
export interface ConnectorKnowledgeBase {
  id: string
  name: string
  workspaceId: string | null
  organizationId?: string | null
}

function withoutSecret(row: ConnectorRow): ConnectorWithoutSecret {
  const { encryptedApiKey: _encryptedApiKey, ...rest } = row
  return rest
}

/**
 * Rejects a sub-hourly sync interval on a workspace without the plan for it.
 * `0` disables scheduled syncs and is always allowed.
 */
async function assertLiveSyncAllowed(
  scope: string | ResourceScope,
  syncIntervalMinutes: number | undefined
): Promise<void> {
  if (syncIntervalMinutes === undefined || syncIntervalMinutes <= 0 || syncIntervalMinutes >= 60) {
    return
  }
  const allowed =
    typeof scope === 'string'
      ? await hasWorkspaceLiveSyncAccess(scope)
      : scope.kind === 'workspace'
        ? await hasWorkspaceLiveSyncAccess(scope.workspaceId)
        : await isOrganizationOnEnterprisePlan(scope.organizationId, 'throw')
  if (!allowed) {
    throw new OrchestrationError('forbidden', 'Live sync requires a Max or Enterprise plan')
  }
}

export interface PerformCreateKnowledgeConnectorParams extends KnowledgeOperationContext {
  knowledgeBase: ConnectorKnowledgeBase
  connectorType: string
  credentialId?: string
  apiKey?: string
  sourceConfig: Record<string, unknown>
  syncIntervalMinutes: number
  /**
   * Present when the connector crawls per member. The binding was validated
   * against the group, the option, and the connector by the caller; the
   * connector is granted the option's credentials before its row exists.
   */
  membersBinding?: ConnectorMembersBinding
  /**
   * How the connector derives document access. `members` is implied by
   * `membersBinding`; `admin` has no binding of its own, so it must be named.
   */
  accessMode?: ConnectorAccessMode
  /** Reuses a matching members source under the knowledge base's existing insertion lock. */
  reuseSearchSource?: boolean
  /**
   * Resolves the payer the sync is billed to. A thunk so a request rejected by
   * a guard never pays for the lookup, and so the payer is read at the moment
   * the sync is dispatched.
   */
  resolveBillingAttribution: () => Promise<BillingAttributionSnapshot>
  /**
   * Resolves an OAuth credential to its access token. Supplied by the caller
   * because credential lookup is scoped to the requesting identity.
   */
  resolveAccessToken: (credentialId: string) => Promise<ConnectorAccessToken | null>
  /** False only when an authorized application use case projects the semantic audit. */
  recordSemanticAudit?: boolean
  /** False when the calling HTTP/tool adapter owns product analytics. */
  recordProductAnalytics?: boolean
}

export type PerformConnectorResult = KnowledgeOrchestrationResult<{
  connector: ConnectorWithoutSecret
  /**
   * Creation only: whether the connector's first sync was actually enqueued.
   * Creation succeeds either way, so the caller reports the sync from this
   * rather than assuming it.
   */
  initialSyncQueued?: boolean
  reused?: boolean
}>

/**
 * Creates a connector on a knowledge base and dispatches its first sync.
 *
 * The tag-slot allocation and the connector insert share one transaction under
 * the knowledge base's row lock, so a knowledge base archived mid-request can
 * never end up with a live connector, and a partial slot allocation cannot
 * outlive a failed insert.
 */
export async function performCreateKnowledgeConnector(
  params: PerformCreateKnowledgeConnectorParams
): Promise<PerformConnectorResult> {
  const {
    knowledgeBase: kb,
    connectorType,
    credentialId,
    apiKey,
    sourceConfig,
    syncIntervalMinutes,
    membersBinding,
    accessMode = 'workspace',
    resolveBillingAttribution,
    resolveAccessToken,
    request,
    source,
  } = params
  const requestId = params.requestId ?? generateRequestId()

  if (!kb.workspaceId && !kb.organizationId) {
    return fail('Knowledge base is missing workspace billing context', 'conflict')
  }
  const workspaceId = kb.workspaceId
  const owner = resourceScopeFields(resourceScopeFromOwner(kb))

  const { CONNECTOR_REGISTRY } = await import('@/connectors/registry.server')
  const connectorConfig = CONNECTOR_REGISTRY[connectorType]
  if (!connectorConfig) {
    return fail(`Unknown connector type: ${connectorType}`, 'validation')
  }

  try {
    await assertLiveSyncAllowed(resourceScopeFromOwner(kb), syncIntervalMinutes)
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Create ${connectorType} connector`)
  }

  let resolvedCredentialId: string | null = null
  let resolvedEncryptedApiKey: string | null = null
  let accessToken: string | null = null
  let tokenContext: Record<string, unknown> = {}
  const apiKeyConfig = getConnectorApiKeyConfig(connectorConfig.auth)
  if (apiKey && (!apiKeyConfig || accessMode === 'members')) {
    return fail('This connection method requires an OAuth account', 'validation')
  }
  if (apiKey && credentialId) {
    return fail('Choose either an OAuth account or an API key', 'validation')
  }
  const usesApiKey = connectorConfig.auth.mode === 'apiKey' || Boolean(apiKeyConfig && apiKey)

  if (membersBinding) {
    /**
     * A members-mode connector has no credential of its own to validate the
     * source with: each member's first crawl validates it for that member.
     * What can be checked here is that the config does not cap listings.
     */
    if (connectorConfig.auth.mode !== 'oauth' || !connectorConfig.permissionScopedListing) {
      return fail(`${connectorConfig.name} cannot sync per member`, 'validation')
    }
    const capViolation = findListingCapViolation(connectorConfig, sourceConfig)
    if (capViolation) return fail(capViolation, 'validation')
    if (credentialId && !connectorConfig.supportsSeparateContentCredential) {
      return fail(
        `${connectorConfig.name} cannot separate content ingestion from member permissions`,
        'validation'
      )
    }
  } else if (!isContentEngineAccessMode(accessMode)) {
    return fail(`Unsupported access mode: ${accessMode}`, 'validation')
  }
  if (usesApiKey) {
    if (!apiKey && !apiKeyConfig?.optional) {
      return fail('API key is required', 'validation')
    }
    accessToken = apiKey ?? ''
  } else if (!membersBinding || credentialId) {
    if (!credentialId) {
      return fail('Credential is required', 'validation')
    }
    let token: ConnectorAccessToken | null
    try {
      token = await resolveAccessToken(credentialId)
    } catch (error) {
      return classifyKnowledgeFailure(error, requestId, `Create ${connectorType} connector`)
    }
    if (!token) {
      return fail('Credential has no access token. Please reconnect your account.', 'validation')
    }
    accessToken = token.accessToken
    tokenContext = syncContextForToken(token)
    resolvedCredentialId = credentialId
  }

  if (accessToken !== null) {
    const configValidation = await connectorConfig.validateConfig(accessToken, sourceConfig, {
      ...tokenContext,
      mirrorsSourceAcls: accessMode === 'admin',
      ...(accessMode === 'members' ? PER_MEMBER_LISTING_CONTEXT : {}),
    })
    if (!configValidation.valid) {
      return fail(
        configValidation.error ||
          `The ${connectorType} connector rejected sourceConfig without a reason — re-check its required fields in knowledgebases/connectors/${connectorType}.json before retrying; the same config will fail again.`,
        'validation'
      )
    }
  }

  if (usesApiKey && apiKey) {
    resolvedEncryptedApiKey = (await encryptApiKey(apiKey)).encrypted
  }

  /** A derived-ACL mode has no listing cap; see `aclIsDerived`. */
  let finalSourceConfig: Record<string, unknown> = aclIsDerived(accessMode)
    ? stripListingCapFields(connectorConfig, sourceConfig)
    : { ...sourceConfig }
  const tagSlotMapping: Record<string, string> = {}
  let newTagSlots: Record<string, string> = {}

  if (connectorConfig.tagDefinitions?.length) {
    const disabledIds = new Set((sourceConfig.disabledTagIds as string[] | undefined) ?? [])
    const enabledDefs = connectorConfig.tagDefinitions.filter((td) => !disabledIds.has(td.id))

    const existingDefs = await db
      .select({
        tagSlot: knowledgeBaseTagDefinitions.tagSlot,
        displayName: knowledgeBaseTagDefinitions.displayName,
        fieldType: knowledgeBaseTagDefinitions.fieldType,
      })
      .from(knowledgeBaseTagDefinitions)
      .where(eq(knowledgeBaseTagDefinitions.knowledgeBaseId, kb.id))

    const usedSlots = new Set<string>(existingDefs.map((d) => d.tagSlot))
    const existingByName = new Map(
      existingDefs.map((d) => [d.displayName, { tagSlot: d.tagSlot, fieldType: d.fieldType }])
    )

    const defsNeedingSlots: typeof enabledDefs = []
    for (const td of enabledDefs) {
      const existing = existingByName.get(td.displayName)
      if (existing && existing.fieldType === td.fieldType) {
        tagSlotMapping[td.id] = existing.tagSlot
      } else {
        defsNeedingSlots.push(td)
      }
    }

    const { mapping, skipped: skippedTags } = allocateTagSlots(defsNeedingSlots, usedSlots)
    Object.assign(tagSlotMapping, mapping)
    newTagSlots = mapping

    for (const name of skippedTags) {
      logger.warn(`[${requestId}] No available slots for "${name}"`)
    }

    if (skippedTags.length > 0 && Object.keys(tagSlotMapping).length === 0) {
      return fail(
        `No available tag slots. Could not assign: ${skippedTags.join(', ')}`,
        'validation'
      )
    }

    finalSourceConfig = { ...finalSourceConfig, tagSlotMapping }
  }

  // Resolved before the write, not after: every guard that can cheaply reject
  // the request has already run, and `requireBillingAttributionHeader` throws on
  // a malformed header. Resolving it post-commit would leave a live connector
  // behind a 500 and let a retry create a duplicate.
  let billingAttribution: BillingAttributionSnapshot
  try {
    billingAttribution = await resolveBillingAttribution()
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Create ${connectorType} connector`)
  }

  const now = new Date()
  const connectorId = generateId()
  const refreshInterval = effectiveConnectorSyncIntervalMinutes(accessMode, syncIntervalMinutes)
  const nextSyncAt =
    refreshInterval > 0 ? new Date(now.getTime() + refreshInterval * 60 * 1000) : null

  /**
   * Granted before the row exists so a connector can never be live without
   * its grant; a failed insert revokes it again. The id is fixed above, so the
   * policy names exactly the row about to be written.
   */
  if (membersBinding && workspaceId) {
    try {
      await grantKnowledgeConnectorCredentialAccess(
        {
          workspaceId,
          credentialGroupId: membersBinding.credentialGroupId,
          credentialGroupOptionId: membersBinding.credentialGroupOptionId,
          connectorId,
        },
        params.userId
      )
    } catch (error) {
      return classifyKnowledgeFailure(error, requestId, `Create ${connectorType} connector`)
    }
  }

  let created: ConnectorRow
  let reused = false
  try {
    created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT 1 FROM knowledge_base WHERE id = ${kb.id} FOR UPDATE`)

      const activeKb = await tx
        .select({ id: knowledgeBase.id })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, kb.id), isNull(knowledgeBase.deletedAt)))
        .limit(1)

      if (activeKb.length === 0) {
        throw new OrchestrationError('not_found', 'Knowledge base not found')
      }
      if (params.reuseSearchSource && membersBinding) {
        const identity = searchSourceIdentity(connectorConfig, sourceConfig)
        const candidates = await tx
          .select()
          .from(knowledgeConnector)
          .where(
            and(
              eq(knowledgeConnector.knowledgeBaseId, kb.id),
              eq(knowledgeConnector.connectorType, connectorType),
              eq(knowledgeConnector.accessMode, 'members'),
              isNull(knowledgeConnector.archivedAt),
              isNull(knowledgeConnector.deletedAt)
            )
          )
        const compatible = candidates.filter(
          (candidate) => searchSourceIdentity(connectorConfig, candidate.sourceConfig) === identity
        )
        if (compatible.length > 1) {
          throw new OrchestrationError(
            'conflict',
            'Several Search sources use these settings. Choose the source you want to connect.'
          )
        }
        if (compatible[0]) {
          if (compatible[0].credentialGroupOptionId !== membersBinding.credentialGroupOptionId) {
            throw new OrchestrationError(
              'conflict',
              'This Search source uses a different account option. Choose the existing source explicitly.'
            )
          }
          reused = true
          return compatible[0]
        }
      }
      if (membersBinding) {
        await lockCredentialGroupOption(tx, { ...owner, ...membersBinding })
      }

      for (const [semanticId, slot] of Object.entries(newTagSlots)) {
        const td = connectorConfig.tagDefinitions?.find((d) => d.id === semanticId)
        if (!td) continue
        await createTagDefinition(
          {
            knowledgeBaseId: kb.id,
            tagSlot: slot,
            displayName: td.displayName,
            fieldType: td.fieldType,
          },
          requestId,
          tx
        )
      }

      const [row] = await tx
        .insert(knowledgeConnector)
        .values({
          id: connectorId,
          knowledgeBaseId: kb.id,
          connectorType,
          credentialId: resolvedCredentialId,
          encryptedApiKey: resolvedEncryptedApiKey,
          sourceConfig: finalSourceConfig,
          syncIntervalMinutes,
          /**
           * The initial sync is dispatched after this transaction commits, so
           * the row is born with a sync already queued. `markSyncPending` writes
           * this again moments later — this one exists so the create *response*
           * is truthful, and the client renders the queued state immediately
           * rather than an idle connector until its first refetch. The lease and
           * ownership token that make the queue entry recoverable come from that
           * later write, which is why it must not skip an already-`pending` row.
           *
           * A members-mode connector is born `active`: its member run has its
           * own queue state, and `pending` here would read as a content sync.
           */
          status: membersBinding ? 'active' : 'pending',
          nextSyncAt: membersBinding ? null : nextSyncAt,
          ...(membersBinding
            ? {
                accessMode: 'members',
                credentialGroupId: membersBinding.credentialGroupId,
                credentialGroupOptionId: membersBinding.credentialGroupOptionId,
                nextMemberSyncAt: now,
              }
            : /**
               * An admin-mode connector is a content-engine connector like a
               * workspace one; only its documents' ACLs differ, and those are
               * written by its own crawl. Nothing else here changes.
               */
              { accessMode }),
          createdAt: now,
          updatedAt: now,
        })
        .returning()

      return row
    })
  } catch (error) {
    if (membersBinding && workspaceId) {
      await revokeKnowledgeConnectorCredentialAccess(
        { workspaceId, credentialGroupId: membersBinding.credentialGroupId, connectorId },
        params.userId
      ).catch((revokeError) => {
        logger.error(`[${requestId}] Failed to revoke the grant of an uncreated connector`, {
          connectorId,
          error: revokeError,
        })
      })
    }
    return classifyKnowledgeFailure(error, requestId, `Create ${connectorType} connector`)
  }

  if (reused && membersBinding) {
    if (workspaceId)
      await revokeKnowledgeConnectorCredentialAccess(
        { workspaceId, credentialGroupId: membersBinding.credentialGroupId, connectorId },
        params.userId
      )
    return { success: true, connector: withoutSecret(created), reused: true }
  }

  logger.info(`[${requestId}] Created connector ${connectorId} for KB ${kb.id}`)

  if (params.recordProductAnalytics !== false) {
    captureServerEvent(
      params.userId,
      'knowledge_base_connector_added',
      {
        knowledge_base_id: kb.id,
        workspace_id: workspaceId ?? undefined,
        organization_id: kb.organizationId ?? undefined,
        connector_type: connectorType,
        sync_interval_minutes: syncIntervalMinutes,
      },
      {
        groups: workspaceId ? { workspace: workspaceId } : { organization: kb.organizationId! },
        setOnce: { first_connector_added_at: new Date().toISOString() },
      }
    )
  }

  if (params.recordSemanticAudit !== false) {
    recordAudit({
      workspaceId,
      ...auditActorFields(params),
      action: AuditAction.CONNECTOR_CREATED,
      resourceType: AuditResourceType.CONNECTOR,
      resourceId: connectorId,
      resourceName: connectorType,
      description: `Created ${connectorType} connector for knowledge base "${kb.name}"`,
      metadata: {
        source,
        knowledgeBaseId: kb.id,
        knowledgeBaseName: kb.name,
        connectorType,
        syncIntervalMinutes,
        authMode: usesApiKey ? 'apiKey' : 'oauth',
      },
      ...(request ? { request } : {}),
    })
  }

  /**
   * Awaited, like the update and manual-sync dispatches: detaching it let the
   * enqueue fail after the caller had already been told the connector was ready,
   * so the failure surfaced nowhere and the row was left waiting on a run that
   * was never queued. The connector itself is created either way — only the
   * initial sync is at stake — so a failed enqueue is reported on the connector,
   * not by failing the creation.
   */
  let initialSyncQueued = true
  try {
    const dispatch = membersBinding
      ? await (await loadDispatchMemberSync())(connectorId, {
          billingAttribution,
          requestId,
          expectedNextMemberSyncAt: now,
        })
      : await (await loadDispatchSync())(connectorId, { billingAttribution, requestId })
    if (!dispatch.queued) {
      initialSyncQueued = false
      logger.warn(
        `[${requestId}] Initial sync for connector ${connectorId} was not queued: ${dispatch.reason}`
      )
    }
  } catch (error) {
    initialSyncQueued = false
    logger.error(
      `[${requestId}] Failed to dispatch initial sync for connector ${connectorId}`,
      error
    )
  }

  return { success: true, connector: withoutSecret(created), initialSyncQueued }
}

export interface PerformUpdateKnowledgeConnectorParams extends KnowledgeOperationContext {
  knowledgeBase: ConnectorKnowledgeBase
  connectorId: string
  updates: {
    sourceConfig?: Record<string, unknown>
    syncIntervalMinutes?: number
    status?: 'active' | 'paused'
  }
  /** Resolves the payer only when a source change will queue synchronization. */
  resolveBillingAttribution: () => Promise<BillingAttributionSnapshot>
  /**
   * Validates a replacement `sourceConfig` against the live source. Supplied by
   * the caller because resolving the connector's token needs the requesting
   * identity. Returning a rejection fails the update.
   *
   * The rejection carries its own `errorCode` so a stale credential and a bad
   * config stay distinguishable — collapsing every rejection to `validation`
   * flattened the route's 401 and 409 into a 400.
   */
  validateSourceConfig?: (
    connector: KnowledgeConnectorRow,
    sourceConfig: Record<string, unknown>
  ) => Promise<SourceConfigRejection | null>
  /** False only when an authorized application use case projects the semantic audit. */
  recordSemanticAudit?: boolean
}

/** Loads an active connector scoped to its knowledge base. */
export async function getKnowledgeConnector(
  knowledgeBaseId: string,
  connectorId: string
): Promise<ConnectorRow | null> {
  const [row] = await db
    .select()
    .from(knowledgeConnector)
    .where(
      and(
        eq(knowledgeConnector.id, connectorId),
        eq(knowledgeConnector.knowledgeBaseId, knowledgeBaseId),
        isNull(knowledgeConnector.archivedAt),
        isNull(knowledgeConnector.deletedAt)
      )
    )
    .limit(1)

  return row ?? null
}

/** Applies a connector configuration change and records it against the actor. */
export async function performUpdateKnowledgeConnector(
  params: PerformUpdateKnowledgeConnectorParams
): Promise<PerformConnectorResult> {
  const {
    knowledgeBase: kb,
    connectorId,
    updates,
    resolveBillingAttribution,
    validateSourceConfig,
    request,
    source,
  } = params
  const requestId = params.requestId ?? generateRequestId()

  const updatedFields = Object.keys(updates).filter(
    (key) => updates[key as keyof typeof updates] !== undefined
  )
  if (updatedFields.length === 0) {
    return fail(
      'At least one of sourceConfig, syncIntervalMinutes, or status is required',
      'validation'
    )
  }

  const existing = await getKnowledgeConnector(kb.id, connectorId)
  if (!existing) {
    return fail('Connector not found', 'not_found')
  }
  /**
   * A running sync owns the row, so no edit is applied while it holds the lock.
   *
   * `performSyncKnowledgeConnector` already refuses on the same condition; this
   * is the other half. `status: 'active'` sets `nextSyncAt = new Date()`, which
   * summons a second run alongside the first, and every write here moves
   * `updatedAt` — which the stale-lock reaper read as the lock's lease, so the
   * only two controls the UI leaves enabled on a wedged connector both pushed
   * its recovery out by another full TTL.
   *
   * A non-status edit is refused too, not just a status flip. `sourceConfig` is
   * read once at the start of a run and threaded through it, so changing it
   * mid-flight yields a pass that lists against one config and reconciles
   * against another — and reconciliation hard-deletes. `syncIntervalMinutes`
   * writes a `nextSyncAt` the run's own terminal write overwrites moments later,
   * so allowing it would silently discard the change. Refusing is the only
   * answer that is honest about either.
   */
  if (existing.status === 'syncing') {
    return fail('Sync already in progress', 'conflict')
  }
  /**
   * A queued run has not read its config yet, so a status change is still safe
   * and is deliberately allowed — refusing it would leave a connector stranded
   * behind a lost queue entry unpausable until the reaper's TTL. The two config
   * edits are refused for the same reasons the `syncing` guard above gives:
   * `sourceConfig` would have the run list against one config and reconcile
   * against another, and `syncIntervalMinutes` writes a `nextSyncAt` the run's
   * terminal write overwrites moments later, silently discarding it.
   */
  if (
    existing.status === 'pending' &&
    (updates.sourceConfig !== undefined || updates.syncIntervalMinutes !== undefined)
  ) {
    return fail('Sync already in progress', 'conflict')
  }
  /**
   * A members-mode connector is run by the member engine, whose lease lives in
   * `memberSyncStatus` while `status` stays `active`, so the two guards above
   * never see it. The same two rules apply to that lease: a running member run
   * owns the row, and a queued one has not read its config yet, so only a
   * status change is safe.
   */
  const syncsPerMember = existing.accessMode === 'members'
  if (syncsPerMember && existing.memberSyncStatus === 'running') {
    return fail('Sync already in progress', 'conflict')
  }
  if (
    syncsPerMember &&
    existing.memberSyncStatus === 'pending' &&
    (updates.sourceConfig !== undefined || updates.syncIntervalMinutes !== undefined)
  ) {
    return fail('Sync already in progress', 'conflict')
  }

  if (updates.syncIntervalMinutes !== undefined) {
    if (
      !kb.workspaceId &&
      !kb.organizationId &&
      updates.syncIntervalMinutes > 0 &&
      updates.syncIntervalMinutes < 60
    ) {
      return fail('Knowledge base is missing workspace billing context', 'conflict')
    }
    if (kb.workspaceId || kb.organizationId) {
      try {
        await assertLiveSyncAllowed(resourceScopeFromOwner(kb), updates.syncIntervalMinutes)
      } catch (error) {
        return classifyKnowledgeFailure(error, requestId, `Update connector ${connectorId}`)
      }
    }
  }

  let sourceConfigToStore = updates.sourceConfig
  if (updates.sourceConfig !== undefined) {
    const accessMode = existing.accessMode as ConnectorAccessMode
    let nextSourceConfig = updates.sourceConfig
    if (aclIsDerived(accessMode)) {
      /** A derived-ACL mode has no listing cap; a save may refuse one, never store one. */
      const { CONNECTOR_REGISTRY } = await import('@/connectors/registry.server')
      const connectorConfig = CONNECTOR_REGISTRY[existing.connectorType]
      if (connectorConfig) {
        const capViolation = findListingCapViolation(connectorConfig, nextSourceConfig)
        if (capViolation) return fail(capViolation, 'validation')
        nextSourceConfig = stripListingCapFields(connectorConfig, nextSourceConfig)
      }
    }
    sourceConfigToStore = nextSourceConfig
    /**
     * A members-mode connector has no credential to validate the source with;
     * the next member run does that per member. Every other mode validates
     * with the credential it syncs as.
     */
    if ((isContentEngineAccessMode(accessMode) || existing.credentialId) && validateSourceConfig) {
      const rejection = await validateSourceConfig(existing, nextSourceConfig)
      if (rejection) {
        return fail(rejection.message, rejection.errorCode)
      }
    }
  }

  const resultingStatus = updates.status ?? existing.status
  const shouldDispatchSourceSync =
    updates.sourceConfig !== undefined &&
    resultingStatus !== 'paused' &&
    resultingStatus !== 'disabled'
  /**
   * The schedule this connector is picked up by: the member scheduler reads
   * `nextMemberSyncAt` and the content scheduler `nextSyncAt`, each only for
   * its own access mode, so every schedule write below lands on the one the
   * connector's engine will read.
   */
  const scheduleColumn = syncsPerMember ? 'nextMemberSyncAt' : 'nextSyncAt'
  const existingSchedule = existing[scheduleColumn]
  let billingAttribution: BillingAttributionSnapshot | undefined
  let dispatchSourceSync: Awaited<ReturnType<typeof loadDispatchSync>> | undefined
  let dispatchMemberSourceSync: Awaited<ReturnType<typeof loadDispatchMemberSync>> | undefined
  if (shouldDispatchSourceSync) {
    try {
      billingAttribution = await resolveBillingAttribution()
      if (syncsPerMember) dispatchMemberSourceSync = await loadDispatchMemberSync()
      else dispatchSourceSync = await loadDispatchSync()
    } catch (error) {
      return classifyKnowledgeFailure(error, requestId, `Update connector ${connectorId}`)
    }
  }

  const updateTimestamp = new Date()
  const values: Partial<typeof knowledgeConnector.$inferInsert> = {
    updatedAt: updateTimestamp,
  }
  if (sourceConfigToStore !== undefined) {
    values.sourceConfig = sourceConfigToStore
    values.lastSyncAt = null
    values.listingCheckpoint = null
    values.directoryCheckpoint = null
  }
  if (updates.syncIntervalMinutes !== undefined) {
    values.syncIntervalMinutes = updates.syncIntervalMinutes
    const refreshInterval = effectiveConnectorSyncIntervalMinutes(
      existing.accessMode as ConnectorAccessMode,
      updates.syncIntervalMinutes
    )
    values[scheduleColumn] =
      refreshInterval > 0
        ? existingSchedule && existingSchedule <= updateTimestamp
          ? existingSchedule
          : new Date(updateTimestamp.getTime() + refreshInterval * 60 * 1000)
        : null
  }
  if (updates.status !== undefined) {
    values.status = updates.status
    /**
     * Releases a queue entry this status change is walking away from, so no
     * token survives on a row that is no longer `pending` and the reaper is not
     * left with a lease it can never match. A queued member run is released the
     * same way: its task starts without re-checking `status`, so the entry has
     * to be gone for a pause to hold, and the CAS below keeps this off a run
     * that has since started.
     */
    if (existing.status === 'pending') {
      values.syncLockToken = null
      values.syncLockLeaseAt = null
    }
    if (syncsPerMember && existing.memberSyncStatus === 'pending') {
      values.memberSyncStatus = 'idle'
      values.memberSyncLockToken = null
      values.memberSyncLockLeaseAt = null
    }
    if (updates.status === 'active') {
      values.consecutiveFailures = 0
      values.lastSyncError = null
      // Resuming a paused connector syncs immediately unless this same request
      // set a schedule, which then owns the next run.
      if (values[scheduleColumn] === undefined) {
        values[scheduleColumn] = new Date()
      }
    }
  }
  if (shouldDispatchSourceSync) {
    values[scheduleColumn] = updateTimestamp
  }

  let updated: ConnectorRow
  try {
    const updateConditions = [
      eq(knowledgeConnector.id, connectorId),
      eq(knowledgeConnector.knowledgeBaseId, kb.id),
      isNull(knowledgeConnector.archivedAt),
      isNull(knowledgeConnector.deletedAt),
    ]
    updateConditions.push(eq(knowledgeConnector.status, existing.status))
    if (syncsPerMember) {
      updateConditions.push(eq(knowledgeConnector.memberSyncStatus, existing.memberSyncStatus))
    }
    if (values[scheduleColumn] !== undefined) {
      updateConditions.push(
        existingSchedule
          ? eq(knowledgeConnector[scheduleColumn], existingSchedule)
          : isNull(knowledgeConnector[scheduleColumn])
      )
    }

    const row = await db.transaction(async (tx) => {
      const [updatedConnector] = await tx
        .update(knowledgeConnector)
        .set(values)
        .where(and(...updateConditions))
        .returning()
      if (updatedConnector && syncsPerMember && sourceConfigToStore !== undefined) {
        await tx
          .update(knowledgeConnectorMember)
          .set({
            listingCheckpoint: null,
            changeCursor: null,
            memberSyncedThrough: null,
            lastCompleteListingAt: null,
            lastListedCount: null,
            nextAttemptAt: updateTimestamp,
            updatedAt: updateTimestamp,
          })
          .where(eq(knowledgeConnectorMember.connectorId, connectorId))
      }
      return updatedConnector
    })

    if (!row) {
      const current = await getKnowledgeConnector(kb.id, connectorId)
      if (current?.status === 'syncing' || current?.memberSyncStatus === 'running') {
        return fail('Sync already in progress', 'conflict')
      }
      if (current) {
        return fail('Connector changed during the update; retry the request', 'conflict')
      }
      return fail('Connector not found', 'not_found')
    }
    updated = row
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Update connector ${connectorId}`)
  }

  if (params.recordSemanticAudit !== false) {
    recordAudit({
      workspaceId: kb.workspaceId,
      ...auditActorFields(params),
      action: AuditAction.CONNECTOR_UPDATED,
      resourceType: AuditResourceType.CONNECTOR,
      resourceId: connectorId,
      resourceName: updated.connectorType,
      description: `Updated connector for knowledge base "${kb.name}"`,
      metadata: {
        source,
        knowledgeBaseId: kb.id,
        knowledgeBaseName: kb.name,
        connectorType: updated.connectorType,
        updatedFields,
        ...(updates.syncIntervalMinutes !== undefined && {
          syncIntervalMinutes: updates.syncIntervalMinutes,
        }),
        ...(updates.status !== undefined && { newStatus: updates.status }),
      },
      ...(request ? { request } : {}),
    })
  }

  if (dispatchMemberSourceSync && billingAttribution) {
    try {
      await dispatchMemberSourceSync(connectorId, {
        billingAttribution,
        expectedNextMemberSyncAt: updateTimestamp,
        requestId,
        requireRunnable: true,
      })
    } catch (error) {
      return classifyKnowledgeFailure(
        error,
        requestId,
        `Dispatch source-change member sync for connector ${connectorId}`
      )
    }
  }

  if (dispatchSourceSync && billingAttribution) {
    try {
      await dispatchSourceSync(connectorId, {
        billingAttribution,
        expectedNextSyncAt: updateTimestamp,
        requestId,
        requireRunnable: true,
      })
    } catch (error) {
      return classifyKnowledgeFailure(
        error,
        requestId,
        `Dispatch source-change sync for connector ${connectorId}`
      )
    }
  }

  return { success: true, connector: withoutSecret(updated) }
}

export interface PerformDeleteKnowledgeConnectorParams extends KnowledgeOperationContext {
  knowledgeBase: ConnectorKnowledgeBase
  connectorId: string
  /**
   * Also hard-delete the documents the connector produced. Defaults to keeping
   * them, which turns them into ordinary standalone knowledge base entries.
   */
  deleteDocuments?: boolean
  /** False only when an authorized application use case projects the semantic audit. */
  recordSemanticAudit?: boolean
  /** False when the calling HTTP/tool adapter owns product analytics. */
  recordProductAnalytics?: boolean
}

/** What actually happened to the connector's documents, for the caller to report. */
export type PerformDeleteKnowledgeConnectorResult = KnowledgeOrchestrationResult<{
  documentsDeleted: number
  documentsKept: number
}>

/**
 * Hard-deletes a connector, either removing the documents it produced or
 * releasing them as standalone entries.
 *
 * Returns the counts so callers state what happened rather than assert it. The
 * copilot tool used to reach this through an internal HTTP self-call that sent
 * no query string, so it always took the keep-documents default while telling
 * the user the documents had been removed.
 */
export async function performDeleteKnowledgeConnector(
  params: PerformDeleteKnowledgeConnectorParams
): Promise<PerformDeleteKnowledgeConnectorResult> {
  const { knowledgeBase: kb, connectorId, request, source } = params
  const deleteDocuments = params.deleteDocuments ?? false
  const requestId = params.requestId ?? generateRequestId()

  const existing = await getKnowledgeConnector(kb.id, connectorId)
  if (!existing) {
    return fail('Connector not found', 'not_found')
  }
  /**
   * A derived ACL is maintained by the connector's sync — observers in
   * members mode, the source's own grants in administrator mode. Detached from
   * the connector a document would keep an ACL nothing maintains: a person the
   * source un-shares from keeps reading, forever. Not a standalone entry
   * anyone asked for.
   */
  if (existing.accessMode !== 'workspace' && !deleteDocuments) {
    return fail(
      'Documents of a connector whose access is derived from the source cannot be kept; delete them with the connector',
      'conflict'
    )
  }

  let docCount: number
  let storageNotification: { context: StorageBillingContext; updatedUsage: number } | undefined
  try {
    const [owner] = await db
      .select({
        id: knowledgeBase.id,
        workspaceId: knowledgeBase.workspaceId,
        organizationId: knowledgeBase.organizationId,
        userId: knowledgeBase.userId,
      })
      .from(knowledgeBase)
      .where(and(eq(knowledgeBase.id, kb.id), isNull(knowledgeBase.deletedAt)))
      .limit(1)
    if (!owner) throw new OrchestrationError('not_found', 'Knowledge base not found')
    if (
      owner.workspaceId !== kb.workspaceId ||
      (owner.organizationId ?? null) !== (kb.organizationId ?? null)
    ) {
      throw new OrchestrationError('conflict', 'Knowledge base ownership changed; retry deletion')
    }
    const storageContext =
      !deleteDocuments && owner.workspaceId
        ? await resolveStorageBillingContext(owner.workspaceId)
        : undefined

    docCount = await db.transaction(async (tx) => {
      /** Match source writes and document deletion: parent KB, connector, then storage ledgers. */
      const [lockedOwner] = await tx
        .select({
          workspaceId: knowledgeBase.workspaceId,
          organizationId: knowledgeBase.organizationId,
          userId: knowledgeBase.userId,
        })
        .from(knowledgeBase)
        .where(and(eq(knowledgeBase.id, kb.id), isNull(knowledgeBase.deletedAt)))
        .for('update')
        .limit(1)
      if (
        !lockedOwner ||
        lockedOwner.workspaceId !== owner.workspaceId ||
        lockedOwner.organizationId !== owner.organizationId ||
        lockedOwner.userId !== owner.userId
      ) {
        throw new OrchestrationError('conflict', 'Knowledge base ownership changed; retry deletion')
      }
      const [lockedConnector] = await tx
        .select({ accessMode: knowledgeConnector.accessMode })
        .from(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            eq(knowledgeConnector.knowledgeBaseId, kb.id),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .for('update')
        .limit(1)
      if (!lockedConnector) throw new OrchestrationError('not_found', 'Connector not found')
      if (!deleteDocuments && lockedConnector.accessMode !== 'workspace') {
        throw new OrchestrationError(
          'conflict',
          'Documents with source-derived access cannot be kept after disconnecting their source'
        )
      }

      let count = 0
      if (deleteDocuments) {
        let afterId: string | undefined
        for (;;) {
          /** Archived rows also lose their connector FK and must not escape deletion or cleanup. */
          const docs = await tx
            .select({ id: document.id, fileUrl: document.fileUrl })
            .from(document)
            .where(
              and(
                eq(document.connectorId, connectorId),
                eq(document.knowledgeBaseId, kb.id),
                afterId ? gt(document.id, afterId) : undefined
              )
            )
            .orderBy(asc(document.id))
            .limit(250)
          if (docs.length === 0) break
          const documentIds = docs.map((doc) => doc.id)
          await tx.delete(embedding).where(inArray(embedding.documentId, documentIds))
          await tx.delete(document).where(inArray(document.id, documentIds))
          await enqueueKnowledgeStorageCleanup(
            tx,
            docs.map((doc) => ({
              ...doc,
              workspaceId: owner.workspaceId,
              organizationId: owner.organizationId,
              userId: owner.userId,
            })),
            requestId
          )
          count += docs.length
          afterId = docs.at(-1)?.id
        }
      } else {
        /** Legacy skipped rows used remote size despite retaining no artifact. */
        await tx
          .update(document)
          .set({ fileSize: 0 })
          .where(
            and(
              eq(document.connectorId, connectorId),
              eq(document.knowledgeBaseId, kb.id),
              isNull(document.storageKey),
              eq(document.fileUrl, '')
            )
          )
        /**
         * Connector bytes are unmetered until detachment. Count retained archived files too;
         * live tombstones are resurrected below, while archived tombstones remain nonbillable.
         */
        const [totals] = await tx
          .select({
            count: sql<number>`COUNT(*)::integer`,
            bytes: sql<string>`COALESCE(SUM(${document.fileSize}::bigint) FILTER (
              WHERE ${document.archivedAt} IS NULL OR ${document.deletedAt} IS NULL
            ), 0)::text`,
          })
          .from(document)
          .where(and(eq(document.connectorId, connectorId), eq(document.knowledgeBaseId, kb.id)))
        count = totals?.count ?? 0
        const retainedBytes = Number(totals?.bytes ?? 0)
        if (!Number.isSafeInteger(retainedBytes) || retainedBytes < 0) {
          throw new Error('Invalid retained connector storage size')
        }
        if (retainedBytes > 0) {
          if (storageContext) {
            const updatedUsage = await incrementStorageUsageForBillingContextInTx(
              tx,
              storageContext,
              retainedBytes
            )
            if (updatedUsage !== undefined)
              storageNotification = { context: storageContext, updatedUsage }
          }
        }
        await tx
          .update(document)
          .set({ deletedAt: null })
          .where(
            and(
              eq(document.connectorId, connectorId),
              eq(document.knowledgeBaseId, kb.id),
              isNull(document.archivedAt)
            )
          )
      }

      const deletedConnectors = await tx
        .delete(knowledgeConnector)
        .where(
          and(
            eq(knowledgeConnector.id, connectorId),
            eq(knowledgeConnector.knowledgeBaseId, kb.id),
            isNull(knowledgeConnector.archivedAt),
            isNull(knowledgeConnector.deletedAt)
          )
        )
        .returning({ id: knowledgeConnector.id })
      if (deletedConnectors.length === 0) {
        throw new OrchestrationError('not_found', 'Connector not found')
      }
      return count
    })
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Delete connector ${connectorId}`)
  }

  if (storageNotification) {
    await maybeNotifyStorageLimitForBillingContext(
      storageNotification.context,
      storageNotification.updatedUsage
    )
  }

  if (deleteDocuments) {
    await Promise.all([
      cleanupUnusedTagDefinitions(kb.id, requestId).catch((error) => {
        logger.warn(`[${requestId}] Failed to cleanup tag definitions`, error)
      }),
    ])
  }

  if (existing.credentialGroupId && kb.workspaceId) {
    await revokeKnowledgeConnectorCredentialAccess(
      {
        workspaceId: kb.workspaceId,
        credentialGroupId: existing.credentialGroupId,
        connectorId,
      },
      params.userId
    ).catch((error) => {
      logger.error(`[${requestId}] Failed to revoke the deleted connector's credential access`, {
        connectorId,
        error,
      })
    })
  }

  logger.info(
    `[${requestId}] Deleted connector ${connectorId}${deleteDocuments ? ` and ${docCount} documents` : `, kept ${docCount} documents`}`
  )

  if (params.recordProductAnalytics !== false) {
    captureServerEvent(
      params.userId,
      'knowledge_base_connector_removed',
      {
        knowledge_base_id: kb.id,
        workspace_id: kb.workspaceId ?? '',
        connector_type: existing.connectorType,
        documents_deleted: deleteDocuments ? docCount : 0,
      },
      kb.workspaceId ? { groups: { workspace: kb.workspaceId } } : undefined
    )
  }

  if (params.recordSemanticAudit !== false) {
    recordAudit({
      workspaceId: kb.workspaceId,
      ...auditActorFields(params),
      action: AuditAction.CONNECTOR_DELETED,
      resourceType: AuditResourceType.CONNECTOR,
      resourceId: connectorId,
      resourceName: existing.connectorType,
      description: `Deleted connector from knowledge base "${kb.name}"`,
      metadata: {
        source,
        knowledgeBaseId: kb.id,
        knowledgeBaseName: kb.name,
        connectorType: existing.connectorType,
        deleteDocuments,
        documentsDeleted: deleteDocuments ? docCount : 0,
        documentsKept: deleteDocuments ? 0 : docCount,
      },
      ...(request ? { request } : {}),
    })
  }

  return {
    success: true,
    documentsDeleted: deleteDocuments ? docCount : 0,
    documentsKept: deleteDocuments ? 0 : docCount,
  }
}

export interface PerformSyncKnowledgeConnectorParams extends KnowledgeOperationContext {
  knowledgeBase: ConnectorKnowledgeBase
  connectorId: string
  /**
   * Resolves the payer the sync is billed to. A thunk so a request rejected by
   * a guard never pays for the lookup.
   */
  resolveBillingAttribution: () => Promise<BillingAttributionSnapshot>
  /** Re-fetch and re-index every already-synced document, not only changed ones. */
  rehydrate?: boolean
  /** False only when an authorized application use case projects the semantic audit. */
  recordSemanticAudit?: boolean
  /** False when the calling HTTP/tool adapter owns product analytics. */
  recordProductAnalytics?: boolean
}

export type PerformSyncKnowledgeConnectorResult = KnowledgeOrchestrationResult

/** Triggers a manual sync for a connector and records who asked for it. */
export async function performSyncKnowledgeConnector(
  params: PerformSyncKnowledgeConnectorParams
): Promise<PerformSyncKnowledgeConnectorResult> {
  const { knowledgeBase: kb, connectorId, resolveBillingAttribution, request, source } = params
  const rehydrate = params.rehydrate ?? false
  const requestId = params.requestId ?? generateRequestId()

  const connector = await getKnowledgeConnector(kb.id, connectorId)
  if (!connector) {
    return fail('Connector not found', 'not_found')
  }
  if (connector.status === 'syncing' || connector.status === 'pending') {
    return fail('Sync already in progress', 'conflict')
  }
  if (connector.memberSyncStatus === 'running' || connector.memberSyncStatus === 'pending') {
    return fail('Sync already in progress', 'conflict')
  }
  if (connector.accessMode === 'members' && connector.memberSyncStatus === 'disabled') {
    return fail(
      connector.lastMemberSyncError ?? 'Member sync is disabled for this connector',
      'conflict'
    )
  }
  /**
   * A paused or disabled connector is not synced on demand.
   *
   * Nothing here can put the pause back: queueing overwrites `status`, and
   * every exit from the run writes its own verdict — success writes `active`,
   * and a lost queue entry writes `error`, which the scheduler's due-sweep then
   * treats as a connector to keep syncing. So one "Sync now" on a paused
   * connector silently resumes it for good. Resuming is a decision the caller
   * has to make explicitly, through the status update that says so.
   */
  if (connector.status === 'paused' || connector.status === 'disabled') {
    return fail(`Connector is ${connector.status}. Resume it before triggering a sync.`, 'conflict')
  }
  if (!kb.workspaceId && !kb.organizationId) {
    return fail('Knowledge base is missing workspace billing context', 'conflict')
  }
  // Resolved before the audit is written, so a rejected payer lookup returns a
  // classified failure rather than escaping as a 500 with a sync already recorded.
  let billingAttribution: BillingAttributionSnapshot
  try {
    billingAttribution = await resolveBillingAttribution()
  } catch (error) {
    return classifyKnowledgeFailure(error, requestId, `Sync connector ${connectorId}`)
  }

  if (rehydrate && connector.accessMode === 'members') {
    return fail(
      'A connector that syncs per member re-hydrates through its members; run a sync instead',
      'validation'
    )
  }
  logger.info(
    `[${requestId}] Manual sync${rehydrate ? ' (full rehydrate)' : ''} triggered for connector ${connectorId}`
  )

  /**
   * The dispatch is awaited, and it only enqueues: it takes the pending lock and
   * hands the run to the queue, it does not run the sync. Detaching it made a
   * failed enqueue invisible — the caller was told the sync was queued while the
   * connector sat `pending` with nothing behind it — and recorded an audit and a
   * product event for work that never started. Awaiting first makes the reported
   * outcome and both records describe what actually happened.
   */
  try {
    /**
     * A manual run is meant to list everyone now, so every active member is
     * made due; otherwise each waits out its own interval and the run claims
     * nobody.
     */
    if (connector.accessMode === 'members') {
      await db
        .update(knowledgeConnectorMember)
        .set({ nextAttemptAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(knowledgeConnectorMember.connectorId, connectorId),
            eq(knowledgeConnectorMember.status, 'active')
          )
        )
    }
    const dispatch =
      connector.accessMode === 'members'
        ? await (await loadDispatchMemberSync())(connectorId, { billingAttribution, requestId })
        : await (await loadDispatchSync())(connectorId, {
            billingAttribution,
            requestId,
            rehydrate,
          })
    /**
     * A guard inside the dispatch declining to queue is reported as a failure
     * rather than a queued sync. Every one of them means the connector's state
     * changed between this operation's own guards and the queue write, so the
     * caller is told the sync did not start instead of being handed a success
     * with an audit and a product event behind it.
     */
    if (!dispatch.queued) {
      logger.warn(
        `[${requestId}] Manual sync for connector ${connectorId} was not queued: ${dispatch.reason}`
      )
      return fail(dispatch.reason ?? 'Sync could not be queued', 'conflict')
    }
  } catch (error) {
    logger.error(
      `[${requestId}] Failed to dispatch manual sync for connector ${connectorId}`,
      error
    )
    return classifyKnowledgeFailure(error, requestId, `Sync connector ${connectorId}`)
  }

  if (params.recordProductAnalytics !== false) {
    captureServerEvent(
      params.userId,
      'knowledge_base_connector_synced',
      {
        knowledge_base_id: kb.id,
        workspace_id: kb.workspaceId ?? '',
        connector_type: connector.connectorType,
      },
      kb.workspaceId ? { groups: { workspace: kb.workspaceId } } : undefined
    )
  }

  if (params.recordSemanticAudit !== false) {
    recordAudit({
      workspaceId: kb.workspaceId,
      ...auditActorFields(params),
      action: AuditAction.CONNECTOR_SYNCED,
      resourceType: AuditResourceType.CONNECTOR,
      resourceId: connectorId,
      resourceName: connector.connectorType,
      description: `Triggered manual sync for connector on knowledge base "${kb.name}"`,
      metadata: {
        source,
        knowledgeBaseId: kb.id,
        knowledgeBaseName: kb.name,
        connectorType: connector.connectorType,
        connectorStatus: connector.status,
        syncType: rehydrate ? 'manual-rehydrate' : 'manual',
      },
      ...(request ? { request } : {}),
    })
  }

  return { success: true }
}
