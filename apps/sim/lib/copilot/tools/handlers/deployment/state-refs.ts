import { db } from '@sim/db'
import { workflowDeploymentVersion } from '@sim/db/schema'
import { and, eq } from 'drizzle-orm'
import { loadWorkflowDeploymentSnapshot } from '@/lib/workflows/persistence/utils'
import type { WorkflowState } from '@/stores/workflows/workflow/types'
import { ensureWorkflowAccess } from '../access'

/** Canonical workflow-state selector: a deployment version number, the live
 * (active) deployment, or the current draft. */
export type WorkflowRef = number | 'live' | 'draft'

export interface ResolvedWorkflowRef {
  state: WorkflowState
  /** Human-readable ref label: "live", "draft", or the version number as a string. */
  ref: string
  version?: number
  isActive?: boolean
  createdAt?: string
}

/**
 * Parse a raw ref param into a canonical WorkflowRef.
 * Accepts a version number, a numeric string, "live"/"active", or "draft"/"current".
 * Throws on anything else.
 */
export function parseWorkflowRef(raw: unknown): WorkflowRef {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim().toLowerCase()
    if (trimmed === 'live' || trimmed === 'active') return 'live'
    if (trimmed === 'draft' || trimmed === 'current') return 'draft'
    if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10)
  }
  throw new Error(`Invalid ref "${String(raw)}": expected a version number, "live", or "draft"`)
}

/**
 * Resolve a (workflowId, ref) pair to a WorkflowState for diffing. Raw stored
 * snapshots are used for version/live (matching checkNeedsRedeployment's baseline),
 * and loadWorkflowDeploymentSnapshot is used for draft. Requires read access.
 */
export async function resolveWorkflowStateRef(
  workflowId: string,
  rawRef: unknown,
  userId: string
): Promise<ResolvedWorkflowRef> {
  const ref = parseWorkflowRef(rawRef)
  await ensureWorkflowAccess(workflowId, userId, 'read')

  if (ref === 'draft') {
    const state = await loadWorkflowDeploymentSnapshot(workflowId)
    if (!state) {
      throw new Error(`Workflow ${workflowId} has no draft state`)
    }
    return { state, ref: 'draft' }
  }

  const whereClause =
    ref === 'live'
      ? and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.isActive, true)
        )
      : and(
          eq(workflowDeploymentVersion.workflowId, workflowId),
          eq(workflowDeploymentVersion.version, ref)
        )

  const [row] = await db
    .select({
      version: workflowDeploymentVersion.version,
      state: workflowDeploymentVersion.state,
      isActive: workflowDeploymentVersion.isActive,
      createdAt: workflowDeploymentVersion.createdAt,
    })
    .from(workflowDeploymentVersion)
    .where(whereClause)
    .limit(1)

  if (!row?.state) {
    throw new Error(
      ref === 'live'
        ? `Workflow ${workflowId} has no active deployment`
        : `Deployment version ${ref} not found for workflow ${workflowId}`
    )
  }

  return {
    state: row.state as WorkflowState,
    ref: ref === 'live' ? 'live' : String(ref),
    version: row.version,
    isActive: row.isActive,
    createdAt: row.createdAt?.toISOString(),
  }
}
