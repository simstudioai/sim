import { db, workflow, workflowDeploymentOperation, workflowDeploymentVersion } from '@sim/db'
import { generateId } from '@sim/utils/id'
import type { DbOrTx } from '@sim/workflow-persistence/types'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import type { InferSelectModel } from 'drizzle-orm'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import {
  canTransitionDeploymentOperation,
  createDeploymentReadiness,
  DEPLOYMENT_OPERATION_PROTOCOL_VERSION,
  type DeploymentComponentStatus,
  type DeploymentOperationAction,
  type DeploymentOperationStatus,
  type DeploymentReadiness,
  isDeploymentOperationAction,
  isDeploymentOperationStatus,
  isDeploymentReadinessComplete,
  parseDeploymentReadiness,
  toSafeDeploymentError,
} from '@/lib/workflows/deployment-lifecycle'

export type WorkflowDeploymentOperation = InferSelectModel<typeof workflowDeploymentOperation>

type PrepareFailureReason =
  | 'workflow_not_found'
  | 'workflow_archived'
  | 'deployment_version_not_found'
  | 'idempotency_conflict'
  | 'invalid_request'

type MutationFailureReason =
  | 'operation_not_found'
  | 'invalid_transition'
  | 'stale_generation'
  | 'invalid_readiness'
  | 'not_ready'
  | 'deployment_version_not_found'

export type PrepareDeploymentOperationResult =
  | { success: true; operation: WorkflowDeploymentOperation; reused: boolean }
  | { success: false; reason: PrepareFailureReason; error: string }

export type DeploymentOperationMutationResult =
  | { success: true; operation: WorkflowDeploymentOperation }
  | { success: false; reason: MutationFailureReason; error: string }

interface PrepareOperationBase {
  workflowId: string
  actorId: string
  requestHash: string
  idempotencyKey?: string
  readinessComponents?: readonly string[]
  tx?: DbOrTx
  onPrepareTransaction?: (tx: DbOrTx, operation: WorkflowDeploymentOperation) => Promise<void>
}

export interface PrepareWorkflowDeploymentParams extends PrepareOperationBase {
  workflowState: WorkflowState
  name?: string | null
  description?: string | null
}

export interface PrepareWorkflowVersionActivationParams extends PrepareOperationBase {
  deploymentVersionId: string
}

export interface DeploymentOperationGeneration {
  workflowId: string
  operationId: string
  generation: number
}

export interface WorkflowDeploymentStatus {
  activeDeployment: {
    deploymentVersionId: string
    version: number
    deployedAt: Date
  } | null
  latestOperation: WorkflowDeploymentOperation | null
}

export interface MarkDeploymentComponentReadinessParams extends DeploymentOperationGeneration {
  component: string
  status: DeploymentComponentStatus
  expectedStatus?: DeploymentComponentStatus
}

export interface ActivateDeploymentOperationParams extends DeploymentOperationGeneration {
  onActivateTransaction?: (tx: DbOrTx, operation: WorkflowDeploymentOperation) => Promise<void>
}

interface PrepareOperationContext {
  tx: DbOrTx
  now: Date
  actorId: string
  workflowId: string
}

interface OperationTarget {
  deploymentVersionId: string
  version: number
}

type ResolveOperationTarget = (context: PrepareOperationContext) =>
  | Promise<
      | { success: true; target: OperationTarget }
      | { success: false; reason: PrepareFailureReason; error: string }
    >
  | {
      success: true
      target: OperationTarget
    }
  | { success: false; reason: PrepareFailureReason; error: string }

const IN_FLIGHT_STATUSES: DeploymentOperationStatus[] = ['preparing', 'activating']

/**
 * Creates an inactive immutable snapshot and a preparing deployment attempt.
 */
export async function prepareWorkflowDeployment(
  params: PrepareWorkflowDeploymentParams
): Promise<PrepareDeploymentOperationResult> {
  return prepareOperation(params, 'deploy', async ({ tx, now, actorId, workflowId }) => {
    const [{ maxVersion }] = await tx
      .select({ maxVersion: sql<number>`COALESCE(MAX(${workflowDeploymentVersion.version}), 0)` })
      .from(workflowDeploymentVersion)
      .where(eq(workflowDeploymentVersion.workflowId, workflowId))
      .limit(1)
    const version = Number(maxVersion) + 1
    const deploymentVersionId = generateId()

    await tx.insert(workflowDeploymentVersion).values({
      id: deploymentVersionId,
      workflowId,
      version,
      name: params.name?.trim() || null,
      description: params.description?.trim() || null,
      state: params.workflowState,
      isActive: false,
      createdAt: now,
      createdBy: actorId,
    })

    return {
      success: true,
      target: { deploymentVersionId, version },
    }
  })
}

/**
 * Creates a preparing attempt targeting an existing immutable snapshot.
 */
export async function prepareWorkflowVersionActivation(
  params: PrepareWorkflowVersionActivationParams
): Promise<PrepareDeploymentOperationResult> {
  return prepareOperation(params, 'activate', async ({ tx, workflowId }) => {
    const [versionRow] = await tx
      .select({
        id: workflowDeploymentVersion.id,
        version: workflowDeploymentVersion.version,
        createdAt: workflowDeploymentVersion.createdAt,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.id, params.deploymentVersionId)
        )
      )
      .limit(1)

    if (!versionRow) {
      return {
        success: false,
        reason: 'deployment_version_not_found',
        error: 'Deployment version not found',
      }
    }

    return {
      success: true,
      target: {
        deploymentVersionId: versionRow.id,
        version: versionRow.version,
      },
    }
  })
}

/**
 * Returns the active immutable version and latest deployment attempt for a workflow.
 */
export async function getWorkflowDeploymentStatus(
  workflowId: string
): Promise<WorkflowDeploymentStatus> {
  const [[activeVersion], [workflowRow], [latestOperation]] = await Promise.all([
    db
      .select({
        id: workflowDeploymentVersion.id,
        version: workflowDeploymentVersion.version,
        createdAt: workflowDeploymentVersion.createdAt,
      })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.version))
      .limit(1),
    db
      .select({ deployedAt: workflow.deployedAt })
      .from(workflow)
      .where(eq(workflow.id, workflowId))
      .limit(1),
    db
      .select()
      .from(workflowDeploymentOperation)
      .where(eq(workflowDeploymentOperation.workflowId, workflowId))
      .orderBy(desc(workflowDeploymentOperation.generation))
      .limit(1),
  ])

  return {
    activeDeployment: activeVersion
      ? {
          deploymentVersionId: activeVersion.id,
          version: activeVersion.version,
          deployedAt: workflowRow?.deployedAt ?? activeVersion.createdAt,
        }
      : null,
    latestOperation: latestOperation ?? null,
  }
}

/**
 * Loads one generation-scoped operation for an outbox worker.
 */
export async function getDeploymentOperation(
  params: DeploymentOperationGeneration
): Promise<WorkflowDeploymentOperation | null> {
  const [operation] = await db
    .select()
    .from(workflowDeploymentOperation)
    .where(
      and(
        eq(workflowDeploymentOperation.id, params.operationId),
        eq(workflowDeploymentOperation.workflowId, params.workflowId),
        eq(workflowDeploymentOperation.generation, params.generation)
      )
    )
    .limit(1)

  return operation ?? null
}

/**
 * Confirms an operation still owns the workflow's latest generation.
 */
export async function isDeploymentOperationCurrent(
  params: DeploymentOperationGeneration & {
    deploymentVersionId?: string
    statuses?: readonly DeploymentOperationStatus[]
  },
  executor: Pick<DbOrTx, 'select'> = db
): Promise<boolean> {
  const [latestOperation] = await executor
    .select({
      id: workflowDeploymentOperation.id,
      generation: workflowDeploymentOperation.generation,
      deploymentVersionId: workflowDeploymentOperation.deploymentVersionId,
      status: workflowDeploymentOperation.status,
    })
    .from(workflowDeploymentOperation)
    .where(eq(workflowDeploymentOperation.workflowId, params.workflowId))
    .orderBy(desc(workflowDeploymentOperation.generation))
    .limit(1)

  if (
    !latestOperation ||
    latestOperation.id !== params.operationId ||
    latestOperation.generation !== params.generation ||
    (params.deploymentVersionId !== undefined &&
      latestOperation.deploymentVersionId !== params.deploymentVersionId)
  ) {
    return false
  }
  if (!params.statuses) return true
  if (!isDeploymentOperationStatus(latestOperation.status)) return false
  return params.statuses.includes(latestOperation.status)
}

/**
 * Protects an inactive v2 candidate from rolling-deploy v1 cleanup workers.
 */
export async function isDeploymentVersionProtectedByCurrentOperation(
  workflowId: string,
  deploymentVersionId: string,
  executor: Pick<DbOrTx, 'select'> = db
): Promise<boolean> {
  const [latestOperation] = await executor
    .select({
      deploymentVersionId: workflowDeploymentOperation.deploymentVersionId,
      protocolVersion: workflowDeploymentOperation.protocolVersion,
      status: workflowDeploymentOperation.status,
    })
    .from(workflowDeploymentOperation)
    .where(eq(workflowDeploymentOperation.workflowId, workflowId))
    .orderBy(desc(workflowDeploymentOperation.generation))
    .limit(1)

  return (
    latestOperation?.deploymentVersionId === deploymentVersionId &&
    latestOperation.protocolVersion === DEPLOYMENT_OPERATION_PROTOCOL_VERSION &&
    isDeploymentOperationStatus(latestOperation.status) &&
    IN_FLIGHT_STATUSES.includes(latestOperation.status)
  )
}

/**
 * Moves the current preparing generation into its activation phase.
 */
export async function beginDeploymentOperationActivation(
  params: DeploymentOperationGeneration
): Promise<DeploymentOperationMutationResult> {
  return db.transaction(async (tx) => {
    const operation = await lockCurrentOperation(tx, params)
    if (!operation.success) return operation

    if (
      !isDeploymentOperationStatus(operation.operation.status) ||
      !canTransitionDeploymentOperation(operation.operation.status, 'activating')
    ) {
      return {
        success: false,
        reason: 'invalid_transition',
        error: `Cannot transition deployment operation from ${operation.operation.status} to activating`,
      }
    }

    const now = new Date()
    await tx
      .update(workflowDeploymentOperation)
      .set({
        status: 'activating',
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowDeploymentOperation.id, params.operationId),
          eq(workflowDeploymentOperation.workflowId, params.workflowId),
          eq(workflowDeploymentOperation.generation, params.generation),
          eq(workflowDeploymentOperation.status, 'preparing')
        )
      )

    return {
      success: true,
      operation: {
        ...operation.operation,
        status: 'activating',
        updatedAt: now,
      },
    }
  })
}

/**
 * Atomically updates one declared component using operation, generation, and
 * component-state compare-and-swap predicates.
 */
export async function markDeploymentComponentReadiness(
  params: MarkDeploymentComponentReadinessParams
): Promise<DeploymentOperationMutationResult> {
  const component = params.component.trim()
  if (!component) {
    return {
      success: false,
      reason: 'invalid_readiness',
      error: 'Deployment readiness component name cannot be empty',
    }
  }

  const now = new Date()
  const expectedStatus = params.expectedStatus ?? 'pending'
  const nextState = {
    status: params.status,
    updatedAt: now.toISOString(),
  }

  const [updated] = await db
    .update(workflowDeploymentOperation)
    .set({
      componentReadiness: sql`jsonb_set(
        ${workflowDeploymentOperation.componentReadiness},
        ARRAY[${component}]::text[],
        ${JSON.stringify(nextState)}::jsonb,
        false
      )`,
      updatedAt: now,
    })
    .where(
      and(
        eq(workflowDeploymentOperation.id, params.operationId),
        eq(workflowDeploymentOperation.workflowId, params.workflowId),
        eq(workflowDeploymentOperation.generation, params.generation),
        inArray(workflowDeploymentOperation.status, IN_FLIGHT_STATUSES),
        sql`${workflowDeploymentOperation.componentReadiness} ? ${component}`,
        sql`${workflowDeploymentOperation.componentReadiness} -> ${component} ->> 'status' = ${expectedStatus}`
      )
    )
    .returning()

  if (!updated) {
    return {
      success: false,
      reason: 'stale_generation',
      error: 'Deployment operation generation or component state is stale',
    }
  }

  return { success: true, operation: updated }
}

/**
 * Atomically activates an all-ready current operation and projects it onto the
 * legacy workflow/version fields.
 */
export async function activateDeploymentOperation(
  params: ActivateDeploymentOperationParams
): Promise<DeploymentOperationMutationResult> {
  return db.transaction(async (tx) => {
    const operationResult = await lockCurrentOperation(tx, params)
    if (!operationResult.success) return operationResult

    const operation = operationResult.operation
    if (
      !isDeploymentOperationStatus(operation.status) ||
      !canTransitionDeploymentOperation(operation.status, 'active')
    ) {
      return {
        success: false,
        reason: 'invalid_transition',
        error: `Cannot transition deployment operation from ${operation.status} to active`,
      }
    }

    const readiness = parseDeploymentReadiness(operation.componentReadiness)
    if (!readiness) {
      return {
        success: false,
        reason: 'invalid_readiness',
        error: 'Deployment operation readiness is invalid',
      }
    }
    if (!isDeploymentReadinessComplete(readiness)) {
      return {
        success: false,
        reason: 'not_ready',
        error: 'Deployment operation components are not all ready',
      }
    }

    const [currentActiveVersion] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, operation.workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.version))
      .limit(1)
    if ((currentActiveVersion?.id ?? null) !== operation.previousActiveVersionId) {
      const supersededAt = new Date()
      await tx
        .update(workflowDeploymentOperation)
        .set({
          status: 'superseded',
          completedAt: supersededAt,
          updatedAt: supersededAt,
        })
        .where(
          and(
            eq(workflowDeploymentOperation.id, operation.id),
            eq(workflowDeploymentOperation.workflowId, operation.workflowId),
            eq(workflowDeploymentOperation.generation, operation.generation),
            eq(workflowDeploymentOperation.status, 'activating')
          )
        )
      return {
        success: false,
        reason: 'stale_generation',
        error: 'Active deployment changed while this operation was preparing',
      }
    }

    if (!operation.deploymentVersionId) {
      return {
        success: false,
        reason: 'deployment_version_not_found',
        error: 'Deployment operation has no target version',
      }
    }

    const [targetVersion] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, operation.workflowId),
          eq(workflowDeploymentVersion.id, operation.deploymentVersionId)
        )
      )
      .limit(1)
    if (!targetVersion) {
      return {
        success: false,
        reason: 'deployment_version_not_found',
        error: 'Deployment version not found',
      }
    }

    const now = new Date()
    if (!isDeploymentOperationAction(operation.action)) {
      return {
        success: false,
        reason: 'invalid_transition',
        error: `Deployment operation action is invalid: ${operation.action}`,
      }
    }

    await tx
      .update(workflowDeploymentVersion)
      .set({ isActive: false })
      .where(eq(workflowDeploymentVersion.workflowId, operation.workflowId))

    await tx
      .update(workflowDeploymentVersion)
      .set({ isActive: true })
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, operation.workflowId),
          eq(workflowDeploymentVersion.id, operation.deploymentVersionId)
        )
      )

    await tx
      .update(workflow)
      .set({
        isDeployed: true,
        deployedAt: now,
      })
      .where(eq(workflow.id, operation.workflowId))

    await tx
      .update(workflowDeploymentOperation)
      .set({
        status: 'active',
        errorCode: null,
        errorMessage: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowDeploymentOperation.id, operation.id),
          eq(workflowDeploymentOperation.generation, operation.generation),
          eq(workflowDeploymentOperation.status, 'activating')
        )
      )

    const activatedOperation: WorkflowDeploymentOperation = {
      ...operation,
      status: 'active',
      errorCode: null,
      errorMessage: null,
      completedAt: now,
      updatedAt: now,
    }
    await params.onActivateTransaction?.(tx, activatedOperation)

    return { success: true, operation: activatedOperation }
  })
}

/**
 * Marks an in-flight operation failed without changing the live deployment.
 */
export async function markDeploymentOperationFailed(
  params: DeploymentOperationGeneration & { error: unknown; errorCode?: string }
): Promise<DeploymentOperationMutationResult> {
  const safeError = toSafeDeploymentError(params.error, params.errorCode)
  return markDeploymentOperationTerminal(params, 'failed', safeError)
}

/**
 * Supersedes every in-flight operation for a workflow. Must run inside the
 * undeploy/archive transaction so a queued preparation cannot activate a
 * version after the user explicitly took the workflow offline.
 */
export async function supersedeInFlightDeploymentOperations(
  executor: DbOrTx,
  workflowId: string
): Promise<void> {
  const now = new Date()
  await executor
    .update(workflowDeploymentOperation)
    .set({
      status: 'superseded',
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(workflowDeploymentOperation.workflowId, workflowId),
        inArray(workflowDeploymentOperation.status, IN_FLIGHT_STATUSES)
      )
    )
}

async function prepareOperation(
  params: PrepareOperationBase,
  action: DeploymentOperationAction,
  resolveTarget: ResolveOperationTarget
): Promise<PrepareDeploymentOperationResult> {
  const actorId = params.actorId.trim()
  const requestHash = params.requestHash.trim()
  const idempotencyKey = params.idempotencyKey?.trim() || null
  if (!actorId || !requestHash) {
    return {
      success: false,
      reason: 'invalid_request',
      error: 'Deployment operation actor and request hash are required',
    }
  }

  let readiness: DeploymentReadiness
  try {
    readiness = createDeploymentReadiness(params.readinessComponents ?? [])
  } catch (error) {
    return {
      success: false,
      reason: 'invalid_request',
      error: toSafeDeploymentError(error, 'invalid_readiness').message,
    }
  }

  const executePrepare = async (tx: DbOrTx): Promise<PrepareDeploymentOperationResult> => {
    const now = new Date()
    const [workflowRow] = await tx
      .select({
        id: workflow.id,
        archivedAt: workflow.archivedAt,
      })
      .from(workflow)
      .where(eq(workflow.id, params.workflowId))
      .for('update')
    if (!workflowRow) {
      return {
        success: false,
        reason: 'workflow_not_found',
        error: 'Workflow not found',
      }
    }
    if (workflowRow.archivedAt) {
      return {
        success: false,
        reason: 'workflow_archived',
        error: 'Cannot change deployment state for an archived workflow',
      }
    }

    if (idempotencyKey) {
      const [existing] = await tx
        .select()
        .from(workflowDeploymentOperation)
        .where(
          and(
            eq(workflowDeploymentOperation.workflowId, params.workflowId),
            eq(workflowDeploymentOperation.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1)
      if (existing) {
        if (existing.requestHash !== requestHash) {
          return {
            success: false,
            reason: 'idempotency_conflict',
            error: 'Idempotency key was already used for a different deployment request',
          }
        }
        return { success: true, operation: existing, reused: true }
      }
    }

    const [currentActiveVersion] = await tx
      .select({ id: workflowDeploymentVersion.id })
      .from(workflowDeploymentVersion)
      .where(
        and(
          eq(workflowDeploymentVersion.workflowId, params.workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      )
      .orderBy(desc(workflowDeploymentVersion.version))
      .limit(1)

    const targetResult = await resolveTarget({
      tx,
      now,
      actorId,
      workflowId: params.workflowId,
    })
    if (!targetResult.success) return targetResult

    const [{ maxGeneration }] = await tx
      .select({
        maxGeneration: sql<number>`COALESCE(MAX(${workflowDeploymentOperation.generation}), 0)`,
      })
      .from(workflowDeploymentOperation)
      .where(eq(workflowDeploymentOperation.workflowId, params.workflowId))
      .limit(1)
    const generation = Number(maxGeneration) + 1

    await tx
      .update(workflowDeploymentOperation)
      .set({
        status: 'superseded',
        completedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(workflowDeploymentOperation.workflowId, params.workflowId),
          inArray(workflowDeploymentOperation.status, IN_FLIGHT_STATUSES)
        )
      )

    const [operation] = await tx
      .insert(workflowDeploymentOperation)
      .values({
        id: generateId(),
        workflowId: params.workflowId,
        deploymentVersionId: targetResult.target.deploymentVersionId,
        version: targetResult.target.version,
        previousActiveVersionId: currentActiveVersion?.id ?? null,
        action,
        protocolVersion: DEPLOYMENT_OPERATION_PROTOCOL_VERSION,
        generation,
        status: 'preparing',
        componentReadiness: readiness,
        errorCode: null,
        errorMessage: null,
        idempotencyKey,
        requestHash,
        actorId,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()

    if (!operation) {
      throw new Error('Failed to create deployment operation')
    }
    await params.onPrepareTransaction?.(tx, operation)
    return { success: true, operation, reused: false }
  }

  return params.tx ? executePrepare(params.tx) : db.transaction(executePrepare)
}

async function lockCurrentOperation(
  tx: DbOrTx,
  params: DeploymentOperationGeneration
): Promise<DeploymentOperationMutationResult> {
  const [workflowRow] = await tx
    .select({ id: workflow.id })
    .from(workflow)
    .where(eq(workflow.id, params.workflowId))
    .for('update')
  if (!workflowRow) {
    return {
      success: false,
      reason: 'operation_not_found',
      error: 'Deployment operation workflow not found',
    }
  }

  const [operation] = await tx
    .select()
    .from(workflowDeploymentOperation)
    .where(
      and(
        eq(workflowDeploymentOperation.id, params.operationId),
        eq(workflowDeploymentOperation.workflowId, params.workflowId),
        eq(workflowDeploymentOperation.generation, params.generation)
      )
    )
    .for('update')
  if (!operation) {
    return {
      success: false,
      reason: 'operation_not_found',
      error: 'Deployment operation not found',
    }
  }

  const [{ maxGeneration }] = await tx
    .select({
      maxGeneration: sql<number>`COALESCE(MAX(${workflowDeploymentOperation.generation}), 0)`,
    })
    .from(workflowDeploymentOperation)
    .where(eq(workflowDeploymentOperation.workflowId, operation.workflowId))
    .limit(1)
  if (Number(maxGeneration) !== params.generation) {
    return {
      success: false,
      reason: 'stale_generation',
      error: 'Deployment operation generation is stale',
    }
  }

  return { success: true, operation }
}

async function markDeploymentOperationTerminal(
  params: DeploymentOperationGeneration,
  status: Extract<DeploymentOperationStatus, 'failed' | 'superseded'>,
  error?: { code: string; message: string }
): Promise<DeploymentOperationMutationResult> {
  const now = new Date()
  const [updated] = await db
    .update(workflowDeploymentOperation)
    .set({
      status,
      errorCode: error?.code ?? null,
      errorMessage: error?.message ?? null,
      completedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(workflowDeploymentOperation.id, params.operationId),
        eq(workflowDeploymentOperation.workflowId, params.workflowId),
        eq(workflowDeploymentOperation.generation, params.generation),
        inArray(workflowDeploymentOperation.status, IN_FLIGHT_STATUSES)
      )
    )
    .returning()

  if (!updated) {
    return {
      success: false,
      reason: 'invalid_transition',
      error: `Deployment operation cannot transition to ${status}`,
    }
  }

  return { success: true, operation: updated }
}
