import { db, workflowDeploymentVersion, workflow as workflowTable } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, ne } from 'drizzle-orm'
import { NextRequest } from 'next/server'
import {
  enqueueOutboxEvent,
  type OutboxHandlerRegistry,
  type ProcessSingleOutboxResult,
  processOutboxEventById,
} from '@/lib/core/outbox/service'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  notifyMcpToolServers,
  removeMcpToolsForWorkflow,
  syncMcpToolsForWorkflow,
} from '@/lib/mcp/workflow-mcp-sync'
import { cleanupWebhooksForWorkflow, saveTriggerWebhooksForDeploy } from '@/lib/webhooks/deploy'
import { createSchedulesForDeploy, deleteSchedulesForWorkflow } from '@/lib/workflows/schedules'
import type { BlockState } from '@/stores/workflows/workflow/types'

const logger = createLogger('WorkflowDeploymentOutbox')

export const WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS = {
  SYNC_ACTIVE_SIDE_EFFECTS: 'workflow.deployment.sync-active-side-effects',
  CLEANUP_INACTIVE_SIDE_EFFECTS: 'workflow.deployment.cleanup-inactive-side-effects',
  CLEANUP_UNDEPLOYED_SIDE_EFFECTS: 'workflow.deployment.cleanup-undeployed-side-effects',
} as const

interface SyncActiveSideEffectsPayload {
  workflowId: string
  deploymentVersionId: string
  userId: string
  requestId?: string
  forceRecreateSubscriptions?: boolean
}

interface CleanupUndeployedSideEffectsPayload {
  workflowId: string
  deploymentVersionIds: string[]
  userId: string
  requestId?: string
}

interface CleanupInactiveSideEffectsPayload {
  workflowId: string
  activeDeploymentVersionId: string
  userId: string
  requestId?: string
}

export async function enqueueWorkflowDeploymentSideEffects(
  executor: Pick<typeof db, 'insert'>,
  payload: SyncActiveSideEffectsPayload
): Promise<string> {
  return enqueueOutboxEvent(
    executor,
    WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.SYNC_ACTIVE_SIDE_EFFECTS,
    payload,
    { maxAttempts: 10 }
  )
}

export async function enqueueWorkflowUndeploySideEffects(
  executor: Pick<typeof db, 'insert'>,
  payload: CleanupUndeployedSideEffectsPayload
): Promise<string> {
  return enqueueOutboxEvent(
    executor,
    WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_UNDEPLOYED_SIDE_EFFECTS,
    payload,
    { maxAttempts: 10 }
  )
}

async function enqueueWorkflowInactiveDeploymentCleanup(
  executor: Pick<typeof db, 'insert'>,
  payload: CleanupInactiveSideEffectsPayload
): Promise<string> {
  return enqueueOutboxEvent(
    executor,
    WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_INACTIVE_SIDE_EFFECTS,
    payload,
    { maxAttempts: 10 }
  )
}

export async function processWorkflowDeploymentOutboxEvent(
  eventId: string
): Promise<ProcessSingleOutboxResult> {
  return processOutboxEventById(eventId, workflowDeploymentOutboxHandlers)
}

const syncActiveSideEffects = async (rawPayload: unknown): Promise<void> => {
  const payload = parseSyncActiveSideEffectsPayload(rawPayload)
  const requestId = payload.requestId ?? generateRequestId()
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, payload.workflowId))
    .limit(1)

  if (!workflowRecord) {
    logger.warn(`[${requestId}] Workflow missing during deployment side-effect sync`, {
      workflowId: payload.workflowId,
    })
    return
  }

  const [versionRow] = await db
    .select({
      id: workflowDeploymentVersion.id,
      state: workflowDeploymentVersion.state,
      isActive: workflowDeploymentVersion.isActive,
    })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, payload.workflowId),
        eq(workflowDeploymentVersion.id, payload.deploymentVersionId)
      )
    )
    .limit(1)

  if (!versionRow?.isActive) {
    logger.info(`[${requestId}] Skipping stale deployment side-effect sync`, {
      workflowId: payload.workflowId,
      deploymentVersionId: payload.deploymentVersionId,
    })
    if (versionRow) {
      await cleanupDeploymentVersionIfInactive({
        workflowId: payload.workflowId,
        deploymentVersionId: payload.deploymentVersionId,
        workflow: workflowRecord as Record<string, unknown>,
        userId: payload.userId,
        requestId,
      })
    }
    return
  }

  const state = versionRow.state as { blocks?: Record<string, BlockState> }
  const blocks = state.blocks ?? {}
  const workflowData = workflowRecord as Record<string, unknown>

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  const request = new NextRequest(new URL('/api/webhooks', getBaseUrl()))
  const triggerSaveResult = await saveTriggerWebhooksForDeploy({
    request,
    workflowId: payload.workflowId,
    workflow: workflowData,
    userId: payload.userId,
    blocks,
    requestId,
    deploymentVersionId: payload.deploymentVersionId,
    forceRecreateSubscriptions: payload.forceRecreateSubscriptions ?? false,
    strictExternalCleanup: true,
  })

  if (!triggerSaveResult.success) {
    throw new Error(triggerSaveResult.error?.message || 'Failed to sync trigger configuration')
  }

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  const scheduleResult = await createSchedulesIfStillActive({
    workflowId: payload.workflowId,
    deploymentVersionId: payload.deploymentVersionId,
    blocks,
  })
  if (!scheduleResult.success) {
    throw new Error(scheduleResult.error || 'Failed to sync schedules')
  }

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  await syncMcpToolsIfStillActive({
    workflowId: payload.workflowId,
    deploymentVersionId: payload.deploymentVersionId,
    requestId,
    state,
  })

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  if (workflowRecord.workspaceId) {
    await pruneWorkflowGroupOutputsIfStillActive({
      workflowId: payload.workflowId,
      deploymentVersionId: payload.deploymentVersionId,
      workspaceId: workflowRecord.workspaceId,
      validBlockIds: new Set(Object.keys(blocks)),
      requestId,
    })
  }

  if (!(await cleanupStaleDeploymentIfNeeded({ payload, workflow: workflowData, requestId }))) {
    return
  }

  await enqueueWorkflowInactiveDeploymentCleanup(db, {
    workflowId: payload.workflowId,
    activeDeploymentVersionId: payload.deploymentVersionId,
    userId: payload.userId,
    requestId,
  })
}

const cleanupInactiveSideEffects = async (rawPayload: unknown): Promise<void> => {
  const payload = parseCleanupInactiveSideEffectsPayload(rawPayload)
  const requestId = payload.requestId ?? generateRequestId()
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, payload.workflowId))
    .limit(1)

  if (!workflowRecord) return

  await cleanupInactiveDeploymentVersions({
    workflowId: payload.workflowId,
    activeDeploymentVersionId: payload.activeDeploymentVersionId,
    workflow: workflowRecord as Record<string, unknown>,
    userId: payload.userId,
    requestId,
  })
}

const cleanupUndeployedSideEffects = async (rawPayload: unknown): Promise<void> => {
  const payload = parseCleanupUndeployedSideEffectsPayload(rawPayload)
  const requestId = payload.requestId ?? generateRequestId()
  const [workflowRecord] = await db
    .select()
    .from(workflowTable)
    .where(eq(workflowTable.id, payload.workflowId))
    .limit(1)

  if (!workflowRecord) return
  const workflowData = workflowRecord as Record<string, unknown>

  for (const deploymentVersionId of payload.deploymentVersionIds) {
    const [versionRow] = await db
      .select({ isActive: workflowDeploymentVersion.isActive })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, payload.workflowId),
          eq(workflowDeploymentVersion.id, deploymentVersionId)
        )
      )
      .limit(1)

    if (!versionRow || versionRow.isActive) continue
    await cleanupDeploymentVersionIfInactive({
      workflowId: payload.workflowId,
      workflow: workflowData,
      userId: payload.userId,
      requestId,
      deploymentVersionId,
    })
  }

  await cleanupNullVersionWebhooksIfStillUndeployed({
    workflowId: payload.workflowId,
    workflow: workflowData,
    requestId,
  })

  await removeMcpToolsIfStillUndeployed(payload.workflowId, requestId)
}

async function cleanupInactiveDeploymentVersions(params: {
  workflowId: string
  activeDeploymentVersionId: string
  workflow: Record<string, unknown>
  userId: string
  requestId: string
}): Promise<void> {
  const inactiveVersions = await db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, params.workflowId),
        ne(workflowDeploymentVersion.id, params.activeDeploymentVersionId),
        eq(workflowDeploymentVersion.isActive, false)
      )
    )

  for (const version of inactiveVersions) {
    await cleanupDeploymentVersionIfInactive({
      workflowId: params.workflowId,
      workflow: params.workflow,
      userId: params.userId,
      requestId: params.requestId,
      deploymentVersionId: version.id,
    })
  }
}

async function cleanupDeploymentVersionIfInactive(params: {
  workflowId: string
  deploymentVersionId: string
  workflow: Record<string, unknown>
  userId: string
  requestId: string
}): Promise<void> {
  if (await isDeploymentVersionActive(params.workflowId, params.deploymentVersionId)) {
    await enqueueWorkflowDeploymentSideEffects(db, {
      workflowId: params.workflowId,
      deploymentVersionId: params.deploymentVersionId,
      userId: params.userId,
      requestId: params.requestId,
      forceRecreateSubscriptions: true,
    })
    return
  }

  const isStillInactive = async () =>
    !(await isDeploymentVersionActive(params.workflowId, params.deploymentVersionId))

  await cleanupWebhooksForWorkflow(
    params.workflowId,
    params.workflow,
    params.requestId,
    params.deploymentVersionId,
    false,
    true,
    isStillInactive
  )

  if (!(await isStillInactive())) {
    await enqueueWorkflowDeploymentSideEffects(db, {
      workflowId: params.workflowId,
      deploymentVersionId: params.deploymentVersionId,
      userId: params.userId,
      requestId: params.requestId,
      forceRecreateSubscriptions: true,
    })
    return
  }

  const deletedSchedules = await deleteSchedulesForDeploymentIfInactive({
    workflowId: params.workflowId,
    deploymentVersionId: params.deploymentVersionId,
  })
  if (!deletedSchedules) {
    if (await isDeploymentVersionActive(params.workflowId, params.deploymentVersionId)) {
      await enqueueWorkflowDeploymentSideEffects(db, {
        workflowId: params.workflowId,
        deploymentVersionId: params.deploymentVersionId,
        userId: params.userId,
        requestId: params.requestId,
        forceRecreateSubscriptions: true,
      })
    }
    return
  }

  if (await isDeploymentVersionActive(params.workflowId, params.deploymentVersionId)) {
    await enqueueWorkflowDeploymentSideEffects(db, {
      workflowId: params.workflowId,
      deploymentVersionId: params.deploymentVersionId,
      userId: params.userId,
      requestId: params.requestId,
      forceRecreateSubscriptions: true,
    })
  }
}

async function deleteSchedulesForDeploymentIfInactive(params: {
  workflowId: string
  deploymentVersionId: string
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [versionRow] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.id, params.deploymentVersionId),
          eq(workflowDeploymentVersion.isActive, false)
        )
      )
      .limit(1)
      .for('update')

    if (!versionRow) return false

    await deleteSchedulesForWorkflow(params.workflowId, tx, params.deploymentVersionId)
    return true
  })
}

async function cleanupStaleDeploymentIfNeeded(params: {
  payload: SyncActiveSideEffectsPayload
  workflow: Record<string, unknown>
  requestId: string
}): Promise<boolean> {
  if (
    await isDeploymentVersionActive(params.payload.workflowId, params.payload.deploymentVersionId)
  ) {
    return true
  }

  logger.info(`[${params.requestId}] Cleaning up stale deployment side effects`, {
    workflowId: params.payload.workflowId,
    deploymentVersionId: params.payload.deploymentVersionId,
  })
  await cleanupDeploymentVersionIfInactive({
    workflowId: params.payload.workflowId,
    workflow: params.workflow,
    userId: params.payload.userId,
    requestId: params.requestId,
    deploymentVersionId: params.payload.deploymentVersionId,
  })
  return false
}

async function isDeploymentVersionActive(
  workflowId: string,
  deploymentVersionId: string
): Promise<boolean> {
  const [versionRow] = await db
    .select({ id: workflowDeploymentVersion.id })
    .from(workflowDeploymentVersion)
    .where(
      and(
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.id, deploymentVersionId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .limit(1)

  return Boolean(versionRow)
}

async function removeMcpToolsIfStillUndeployed(
  workflowId: string,
  requestId: string
): Promise<void> {
  const tools = await db.transaction(async (tx) => {
    const [workflowRecord] = await tx
      .select({ id: workflowTable.id, isDeployed: workflowTable.isDeployed })
      .from(workflowTable)
      .where(eq(workflowTable.id, workflowId))
      .limit(1)
      .for('update')

    if (!workflowRecord || workflowRecord.isDeployed) return []
    return removeMcpToolsForWorkflow(workflowId, requestId, tx, false, true)
  })
  notifyMcpToolServers(tools)
}

async function cleanupNullVersionWebhooksIfStillUndeployed(params: {
  workflowId: string
  workflow: Record<string, unknown>
  requestId: string
}): Promise<void> {
  const isStillUndeployed = async () => {
    const [workflowRecord] = await db
      .select({ isDeployed: workflowTable.isDeployed })
      .from(workflowTable)
      .where(eq(workflowTable.id, params.workflowId))
      .limit(1)

    return Boolean(workflowRecord && !workflowRecord.isDeployed)
  }

  if (!(await isStillUndeployed())) return
  await cleanupWebhooksForWorkflow(
    params.workflowId,
    params.workflow,
    params.requestId,
    null,
    false,
    true,
    isStillUndeployed
  )
}

async function syncMcpToolsIfStillActive(params: {
  workflowId: string
  deploymentVersionId: string
  requestId: string
  state: { blocks?: Record<string, unknown> }
}): Promise<void> {
  const tools = await db.transaction(async (tx) => {
    const [workflowRecord] = await tx
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(eq(workflowTable.id, params.workflowId))
      .limit(1)
      .for('update')

    if (!workflowRecord) return []

    const [versionRow] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.id, params.deploymentVersionId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (!versionRow) return []

    return syncMcpToolsForWorkflow({
      workflowId: params.workflowId,
      requestId: params.requestId,
      state: params.state,
      context: 'deployment-outbox',
      tx,
      notify: false,
      throwOnError: true,
    })
  })
  notifyMcpToolServers(tools)
}

async function createSchedulesIfStillActive(params: {
  workflowId: string
  deploymentVersionId: string
  blocks: Record<string, BlockState>
}) {
  return db.transaction(async (tx) => {
    const [workflowRecord] = await tx
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(eq(workflowTable.id, params.workflowId))
      .limit(1)
      .for('update')

    if (!workflowRecord) {
      return { success: true as const }
    }

    const [versionRow] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.id, params.deploymentVersionId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (!versionRow) {
      return { success: true as const }
    }

    const result = await createSchedulesForDeploy(
      params.workflowId,
      params.blocks,
      tx,
      params.deploymentVersionId
    )
    if (!result.success) {
      throw new Error(result.error || 'Failed to sync schedules')
    }
    return result
  })
}

async function pruneWorkflowGroupOutputsIfStillActive(params: {
  workflowId: string
  deploymentVersionId: string
  workspaceId: string
  validBlockIds: Set<string>
  requestId: string
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [workflowRecord] = await tx
      .select({ id: workflowTable.id })
      .from(workflowTable)
      .where(eq(workflowTable.id, params.workflowId))
      .limit(1)
      .for('update')

    if (!workflowRecord) return

    const [versionRow] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.id, params.deploymentVersionId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .limit(1)

    if (!versionRow) return

    const { pruneStaleWorkflowGroupOutputs } = await import('@/lib/table/service')
    await pruneStaleWorkflowGroupOutputs({
      workflowId: params.workflowId,
      workspaceId: params.workspaceId,
      validBlockIds: params.validBlockIds,
      requestId: params.requestId,
      tx,
    })
  })
}

function parseSyncActiveSideEffectsPayload(payload: unknown): SyncActiveSideEffectsPayload {
  const record = parsePayloadRecord(payload)
  const workflowId = parseRequiredString(record.workflowId, 'workflowId')
  const deploymentVersionId = parseRequiredString(record.deploymentVersionId, 'deploymentVersionId')
  const userId = parseRequiredString(record.userId, 'userId')
  const requestId =
    typeof record.requestId === 'string' && record.requestId.length > 0
      ? record.requestId
      : undefined
  const forceRecreateSubscriptions =
    typeof record.forceRecreateSubscriptions === 'boolean'
      ? record.forceRecreateSubscriptions
      : undefined

  return { workflowId, deploymentVersionId, userId, requestId, forceRecreateSubscriptions }
}

function parseCleanupUndeployedSideEffectsPayload(
  payload: unknown
): CleanupUndeployedSideEffectsPayload {
  const record = parsePayloadRecord(payload)
  const workflowId = parseRequiredString(record.workflowId, 'workflowId')
  const userId = parseRequiredString(record.userId, 'userId')
  const deploymentVersionIds = parseRequiredStringArray(
    record.deploymentVersionIds,
    'deploymentVersionIds'
  )
  const requestId =
    typeof record.requestId === 'string' && record.requestId.length > 0
      ? record.requestId
      : undefined

  return { workflowId, deploymentVersionIds, userId, requestId }
}

function parseCleanupInactiveSideEffectsPayload(
  payload: unknown
): CleanupInactiveSideEffectsPayload {
  const record = parsePayloadRecord(payload)
  const workflowId = parseRequiredString(record.workflowId, 'workflowId')
  const activeDeploymentVersionId = parseRequiredString(
    record.activeDeploymentVersionId,
    'activeDeploymentVersionId'
  )
  const userId = parseRequiredString(record.userId, 'userId')
  const requestId =
    typeof record.requestId === 'string' && record.requestId.length > 0
      ? record.requestId
      : undefined

  return { workflowId, activeDeploymentVersionId, userId, requestId }
}

function parsePayloadRecord(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Deployment outbox payload must be an object')
  }
  return payload as Record<string, unknown>
}

function parseRequiredString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Deployment outbox payload is missing ${fieldName}`)
  }
  return value
}

function parseRequiredStringArray(value: unknown, fieldName: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new Error(`Deployment outbox payload is missing ${fieldName}`)
  }
  return value
}

export const workflowDeploymentOutboxHandlers: OutboxHandlerRegistry = {
  [WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.SYNC_ACTIVE_SIDE_EFFECTS]: syncActiveSideEffects,
  [WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_INACTIVE_SIDE_EFFECTS]: cleanupInactiveSideEffects,
  [WORKFLOW_DEPLOYMENT_OUTBOX_EVENTS.CLEANUP_UNDEPLOYED_SIDE_EFFECTS]: cleanupUndeployedSideEffects,
}
