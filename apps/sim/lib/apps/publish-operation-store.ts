import { db } from '@sim/db'
import { appProject, appPublishOperation } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'

export const APP_PUBLISH_OPERATION_STAGES = [
  'deploying',
  'rebinding',
  'building',
  'preparing',
  'publishing',
  'published',
] as const

export type AppPublishOperationStage = (typeof APP_PUBLISH_OPERATION_STAGES)[number]
export type AppPublishDeployment = { workflowId: string; deploymentVersionId: string }
export type AppPublishOperation = typeof appPublishOperation.$inferSelect

const LEASE_DURATION_MS = 2 * 60 * 60 * 1000

export type InitializePublishOperationResult =
  | { ok: true; operation: AppPublishOperation; resumed: boolean }
  | { ok: false; error: string; code: string; status: number }

/**
 * Captures the source revision exactly once. The project row lock closes the
 * race between expected-version validation and durable operation creation.
 */
export async function initializePublishOperation(params: {
  operationId: string
  projectId: string
  userId: string
  expectedVersion?: number
}): Promise<InitializePublishOperationResult> {
  return db.transaction(async (tx): Promise<InitializePublishOperationResult> => {
    const [project] = await tx
      .select()
      .from(appProject)
      .where(and(eq(appProject.id, params.projectId), isNull(appProject.archivedAt)))
      .for('update')
      .limit(1)
    if (!project) {
      return { ok: false, error: 'Project not found', code: 'NOT_FOUND', status: 404 }
    }

    const [existing] = await tx
      .select()
      .from(appPublishOperation)
      .where(eq(appPublishOperation.id, params.operationId))
      .for('update')
      .limit(1)
    if (existing) {
      if (
        existing.projectId !== params.projectId ||
        (existing.requestedBy !== null && existing.requestedBy !== params.userId)
      ) {
        return {
          ok: false,
          error: 'Publish operation ID is already in use',
          code: 'OPERATION_ID_CONFLICT',
          status: 409,
        }
      }
      return { ok: true, operation: existing, resumed: true }
    }

    if (!project.draftRevisionId) {
      return {
        ok: false,
        error: 'App has no draft revision',
        code: 'NO_DRAFT',
        status: 400,
      }
    }
    if (typeof params.expectedVersion === 'number' && params.expectedVersion !== project.version) {
      return {
        ok: false,
        error: 'Project changed concurrently; reload and retry',
        code: 'CONFLICT',
        status: 409,
      }
    }

    const [created] = await tx
      .insert(appPublishOperation)
      .values({
        id: params.operationId,
        projectId: params.projectId,
        requestedBy: params.userId,
        sourceRevisionId: project.draftRevisionId,
        expectedVersion: params.expectedVersion,
        reboundRevisionId: generateId(),
        releaseId: generateId(),
      })
      .returning()
    return { ok: true, operation: created, resumed: false }
  })
}

export async function acquirePublishOperationLease(
  operationId: string,
  leaseToken: string
): Promise<
  | { ok: true; operation: AppPublishOperation }
  | { ok: false; operation: AppPublishOperation; retryAfterMs: number }
> {
  return db.transaction(async (tx) => {
    const [operation] = await tx
      .select()
      .from(appPublishOperation)
      .where(eq(appPublishOperation.id, operationId))
      .for('update')
      .limit(1)
    if (!operation) throw new Error('Publish operation disappeared')

    const now = Date.now()
    if (
      operation.leaseToken &&
      operation.leaseToken !== leaseToken &&
      operation.leaseExpiresAt &&
      operation.leaseExpiresAt.getTime() > now
    ) {
      return {
        ok: false as const,
        operation,
        retryAfterMs: operation.leaseExpiresAt.getTime() - now,
      }
    }

    const [leased] = await tx
      .update(appPublishOperation)
      .set({
        leaseToken,
        leaseExpiresAt: new Date(now + LEASE_DURATION_MS),
        updatedAt: new Date(now),
      })
      .where(eq(appPublishOperation.id, operationId))
      .returning()
    return { ok: true as const, operation: leased }
  })
}

export async function updatePublishOperation(
  operationId: string,
  leaseToken: string,
  patch: {
    stage?: AppPublishOperationStage
    deployments?: AppPublishDeployment[]
    buildId?: string | null
    errorCode?: string | null
    errorMessage?: string | null
    completedAt?: Date | null
  }
): Promise<AppPublishOperation> {
  const now = new Date()
  const [updated] = await db
    .update(appPublishOperation)
    .set({
      ...patch,
      leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_MS),
      updatedAt: now,
    })
    .where(
      and(eq(appPublishOperation.id, operationId), eq(appPublishOperation.leaseToken, leaseToken))
    )
    .returning()
  if (!updated) throw new Error('Publish operation lease was lost')
  return updated
}

export async function releasePublishOperationLease(
  operationId: string,
  leaseToken: string
): Promise<void> {
  await db
    .update(appPublishOperation)
    .set({ leaseToken: null, leaseExpiresAt: null, updatedAt: new Date() })
    .where(
      and(eq(appPublishOperation.id, operationId), eq(appPublishOperation.leaseToken, leaseToken))
    )
}
