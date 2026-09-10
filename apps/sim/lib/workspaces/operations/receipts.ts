import { createHash } from 'node:crypto'
import { db } from '@sim/db'
import { workspaceOperationReceipt } from '@sim/db/schema'
import { sortObjectKeysDeep } from '@sim/utils/object'
import { and, eq, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { DbOrTx } from '@/lib/db/types'
import type { DeploymentOperationStatus } from '@/lib/workflows/deployment-lifecycle'
import type { CreateForkResult } from '@/ee/workspace-forking/lib/create-fork'
import type { PromoteForkResult } from '@/ee/workspace-forking/lib/promote/promote'

export type WorkspaceOperationKind =
  | 'workflow_import'
  | 'workspace_fork'
  | 'workspace_push'
  | 'workspace_pull'
export type WorkspaceOperationStatus =
  | 'processing'
  | 'completed'
  | 'completed_with_warnings'
  | 'requires_configuration'
  | 'failed'

export interface WorkspaceOperationIssue {
  code: string
  message: string
  workflowId?: string
  blockId?: string
  subBlockKey?: string
}

export interface WorkspaceOperationReport {
  operationId: string
  requestId: string
  workspaceId: string
  kind: WorkspaceOperationKind
  applied: true
  status: WorkspaceOperationStatus
  resourceIds: string[]
  issues: WorkspaceOperationIssue[]
  idMap?: Record<string, string>
  deploymentOperationIds?: string[]
  effectEventIds?: string[]
  triggerUrlChanges?: PromoteForkResult['triggerUrlChanges']
  completionRecorded?: boolean
  deployments?: Array<{
    operationId: string
    workflowId: string
    version: number
    status: DeploymentOperationStatus
    ready: boolean
    pendingComponents: string[]
  }>
  backgroundWorkId?: string
  contentOutboxEventId?: string
  copyProgress?: { status: 'pending' | 'completed' | 'failed'; copied: number; failed: number }
  forkResult?: Omit<CreateForkResult, 'operation' | 'replayed'>
  syncResult?: Omit<PromoteForkResult, 'operation' | 'replayed'>
  importedWorkflow?: {
    id: string
    name: string
    description: string | null
    workspaceId: string
    folderId: string | null
    folderPath: string
    sortOrder: number
    createdAt: string
    updatedAt: string
  }
}

export class WorkspaceOperationConflict extends OrchestrationError {
  constructor(
    message: string,
    readonly details: Record<string, unknown>
  ) {
    super('conflict', message)
  }
}

/** Hash only normalized domain input, excluding transport request IDs and timestamps. */
export function workflowOperationFingerprint(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(sortObjectKeysDeep(value)))
    .digest('hex')
}

/** Serializes absent receipts as well as existing ones without a separately committed claim. */
export async function lockWorkspaceOperationRequest(
  tx: DbOrTx,
  workspaceId: string,
  requestId: string
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['workspace-operation', workspaceId, requestId])}, 0))`
  )
}

/** Call only after the application use case has authorized the current principal. */
export async function findWorkspaceOperationReceipt(
  executor: DbOrTx,
  workspaceId: string,
  requestId: string,
  requestHash: string
): Promise<WorkspaceOperationReport | null> {
  const [row] = await executor
    .select({
      requestHash: workspaceOperationReceipt.requestHash,
      report: workspaceOperationReceipt.report,
    })
    .from(workspaceOperationReceipt)
    .where(
      and(
        eq(workspaceOperationReceipt.workspaceId, workspaceId),
        eq(workspaceOperationReceipt.requestId, requestId)
      )
    )
    .limit(1)
  if (!row) return null
  if (row.requestHash !== requestHash) {
    throw new WorkspaceOperationConflict('requestId was already used with different inputs', {
      requestId,
      reason: 'request_id_reused',
    })
  }
  return row.report as WorkspaceOperationReport
}

/** Call after authorization; a concurrent identical commit wins over a stale preflight refusal. */
export async function withWorkspaceOperationReplay<T>(
  scope: { workspaceId: string; requestId: string; requestHash: string },
  replay: (report: WorkspaceOperationReport) => T,
  apply: () => Promise<T>
): Promise<T> {
  const existing = await findWorkspaceOperationReceipt(
    db,
    scope.workspaceId,
    scope.requestId,
    scope.requestHash
  )
  if (existing) return replay(existing)
  try {
    return await apply()
  } catch (error) {
    const committed = await findWorkspaceOperationReceipt(
      db,
      scope.workspaceId,
      scope.requestId,
      scope.requestHash
    )
    if (committed) return replay(committed)
    throw error
  }
}

/** The report stores resource identities and outcomes, never graph state or credentials. */
export async function insertWorkspaceOperationReceipt(
  tx: DbOrTx,
  requestHash: string,
  report: WorkspaceOperationReport
): Promise<void> {
  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > 1024 * 1024) {
    throw new OrchestrationError('payload_too_large', 'Operation report exceeds 1 MiB')
  }
  await tx.insert(workspaceOperationReceipt).values({
    id: report.operationId,
    workspaceId: report.workspaceId,
    requestId: report.requestId,
    requestHash,
    kind: report.kind,
    report,
  })
}
