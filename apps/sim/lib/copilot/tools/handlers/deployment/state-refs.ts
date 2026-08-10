import type {
  ResolvedWorkflowStateReference,
  WorkflowStateReference,
} from '@/lib/workflows/application/read-workflow-state-references'

/** Canonical workflow-state selector: a deployment version number, the live
 * (active) deployment, or the current draft. */
export type WorkflowRef = WorkflowStateReference
export type ResolvedWorkflowRef = ResolvedWorkflowStateReference

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
