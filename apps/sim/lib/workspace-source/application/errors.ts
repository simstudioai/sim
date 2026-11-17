import { getErrorMessage } from '@sim/utils/errors'
import type { WorkspaceKind } from '@sim/workspace-code'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { WorkflowSourceStaleError } from '@/lib/workflows/application/source-error'
import { GET_HINT } from '@/lib/workspace-source/application/findings'
import type { WorkspaceSourceDiagnostic } from '@/lib/workspace-source/application/types'
import { ResourceKeyTakenError } from '@/lib/workspaces/resource-keys'

/**
 * Workspace source an apply refused before writing anything. The status follows the most
 * specific error: a resource changed since the directory was read is `409` (`SOURCE_STALE`), a
 * locked one `423`, a size limit `413`, anything else `400`.
 */
export class WorkspaceSourceRejectedError extends OrchestrationError {
  readonly stale: boolean

  constructor(readonly diagnostics: WorkspaceSourceDiagnostic[]) {
    const errors = diagnostics.filter((finding) => finding.severity === 'error')
    const codes = new Set(errors.map((finding) => finding.code))
    super(
      codes.has('E_APPLY_STALE')
        ? 'conflict'
        : codes.has('E_APPLY_LOCKED')
          ? 'locked'
          : codes.has('E_LIMIT_EXCEEDED') || codes.has('E_PLAN_TOO_LARGE')
            ? 'payload_too_large'
            : 'validation',
      `The workspace source has ${errors.length} error(s); nothing was written. See details.diagnostics.`
    )
    this.name = 'WorkspaceSourceRejectedError'
    this.stale = codes.has('E_APPLY_STALE')
  }
}

/** A resource changed on the server between the plan and its write; nothing of it was written. */
export class ResourceChangedError extends OrchestrationError {
  constructor(resource: { kind: WorkspaceKind; key: string }) {
    super(
      'conflict',
      `${resource.kind} ${resource.key} changed on the server while this apply ran.`
    )
    this.name = 'ResourceChangedError'
  }
}

/**
 * A child use case's refusal as a finding about one resource: forbidden is `E_APPLY_FORBIDDEN`,
 * locked `E_APPLY_LOCKED`, a taken key or name `E_NAME_TAKEN`, any other expected failure
 * `E_APPLY_REFUSED` with its message. Anything else (a database or network failure) is rethrown,
 * never reported as the caller's fault.
 */
export function refusalDiagnostic(
  error: unknown,
  resource: { kind: WorkspaceKind; key?: string }
): WorkspaceSourceDiagnostic {
  if (error instanceof ResourceChangedError || error instanceof WorkflowSourceStaleError) {
    return {
      code: 'E_APPLY_STALE',
      severity: 'error',
      message: getErrorMessage(error),
      hint: GET_HINT,
      ...resource,
    }
  }
  if (error instanceof ResourceKeyTakenError) {
    return {
      code: 'E_NAME_TAKEN',
      severity: 'error',
      message: error.message,
      hint: 'Rename the key, or delete the resource that holds it.',
      ...resource,
    }
  }
  if (!(error instanceof OrchestrationError) || error.code === 'internal') throw error
  const message = getErrorMessage(error)
  switch (error.code) {
    case 'forbidden':
    case 'unauthorized':
      return { code: 'E_APPLY_FORBIDDEN', severity: 'error', message, ...resource }
    case 'locked':
      return { code: 'E_APPLY_LOCKED', severity: 'error', message, ...resource }
    case 'conflict':
      return { code: 'E_NAME_TAKEN', severity: 'error', message, ...resource }
    default:
      return { code: 'E_APPLY_REFUSED', severity: 'error', message, ...resource }
  }
}
