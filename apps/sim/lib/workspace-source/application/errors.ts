import { getErrorMessage } from '@sim/utils/errors'
import type { BaseResource, WorkspaceKind } from '@sim/workspace-code'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { KnowledgeBaseConflictError } from '@/lib/knowledge/service'
import { TableConflictError } from '@/lib/table/service'
import {
  WorkspaceFileFolderConflictError,
  WorkspaceFileMoveConflictError,
} from '@/lib/uploads/contexts/workspace/file-folder-manager'
import { FileConflictError } from '@/lib/uploads/contexts/workspace/file-manager'
import {
  WorkflowSourceNameTakenError,
  WorkflowSourceStaleError,
} from '@/lib/workflows/application/source-error'
import { finding, GET_HINT } from '@/lib/workspace-source/application/findings'
import type {
  PlannedChange,
  WorkspaceSourceDiagnostic,
} from '@/lib/workspace-source/application/types'
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
 * Refuses a write to a resource whose fingerprint (`current`, read just before the write) moved
 * since the plan recorded it, so a document added or a tool edited in the UI between the plan and
 * the write is never lost silently.
 */
export function assertUnchanged(change: PlannedChange, current: string): void {
  if (change.serverFingerprint !== undefined && current !== change.serverFingerprint) {
    throw new ResourceChangedError(change)
  }
}

/**
 * A write that failed after part of it committed (a table update runs one use case per column
 * change). `base` is the resource's base entry as it now stands, so the apply records it and the
 * next run plans only the remainder instead of finding the resource changed since its base.
 */
export class PartiallyAppliedError extends Error {
  constructor(
    cause: unknown,
    readonly base: BaseResource
  ) {
    super(getErrorMessage(cause), { cause })
    this.name = 'PartiallyAppliedError'
  }
}

/** The errors the owning use cases throw for a name another resource holds. */
const NAME_TAKEN_ERRORS = [
  TableConflictError,
  KnowledgeBaseConflictError,
  WorkflowSourceNameTakenError,
  FileConflictError,
  WorkspaceFileFolderConflictError,
  WorkspaceFileMoveConflictError,
]

function isNameTaken(error: unknown): error is OrchestrationError {
  return NAME_TAKEN_ERRORS.some((NameTaken) => error instanceof NameTaken)
}

/**
 * A child use case's refusal as a finding about one resource: forbidden is `E_APPLY_FORBIDDEN`,
 * locked `E_APPLY_LOCKED`, a taken key or a name a use case reports taken `E_NAME_TAKEN`, any
 * other expected failure (another conflict included) `E_APPLY_REFUSED` with its message.
 * Anything else (a database or network failure) is rethrown, never reported as the caller's fault.
 */
export function refusalDiagnostic(
  error: unknown,
  resource: { kind: WorkspaceKind; key?: string }
): WorkspaceSourceDiagnostic {
  if (error instanceof ResourceChangedError || error instanceof WorkflowSourceStaleError) {
    return finding('E_APPLY_STALE', getErrorMessage(error), { hint: GET_HINT, ...resource })
  }
  if (error instanceof ResourceKeyTakenError || isNameTaken(error)) {
    return finding('E_NAME_TAKEN', error.message, {
      ...(error instanceof ResourceKeyTakenError
        ? { hint: 'Rename the key, or delete the resource that holds it.' }
        : {}),
      ...resource,
    })
  }
  if (!(error instanceof OrchestrationError) || error.code === 'internal') throw error
  const message = getErrorMessage(error)
  switch (error.code) {
    case 'forbidden':
    case 'unauthorized':
      return finding('E_APPLY_FORBIDDEN', message, resource)
    case 'locked':
      return finding('E_APPLY_LOCKED', message, resource)
    default:
      return finding('E_APPLY_REFUSED', message, resource)
  }
}
