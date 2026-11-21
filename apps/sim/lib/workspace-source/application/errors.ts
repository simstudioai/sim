import { getErrorMessage } from '@sim/utils/errors'
import { SOURCE_ENTRY_FILE } from '@sim/workflow-code/limits'
import { refusalClass, type WorkspaceKind } from '@sim/workspace-code'
import { workflowFolder } from '@sim/workspace-code/kinds/workflow'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { KnowledgeBaseConflictError } from '@/lib/knowledge/service'
import { TableRowsChangedError } from '@/lib/table/application/errors'
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
 * specific error of those that refuse it (`refusing`, by default every error in `diagnostics`;
 * a plan leaves out those of changes it holds back): a resource changed since the directory was
 * read is `409` (`SOURCE_STALE`), a locked one `423`, a size limit `413`, anything else `400`.
 */
export class WorkspaceSourceRejectedError extends OrchestrationError {
  constructor(
    readonly diagnostics: WorkspaceSourceDiagnostic[],
    refusing: readonly WorkspaceSourceDiagnostic[] = diagnostics
  ) {
    const errors = refusing.filter((finding) => finding.severity === 'error')
    super(
      refusalClass(errors.map((finding) => finding.code)),
      `The workspace source has ${errors.length} error(s); nothing was written. See details.diagnostics.`
    )
    this.name = 'WorkspaceSourceRejectedError'
  }

  /** Whether a resource changed on the server since the directory was read. */
  get stale(): boolean {
    return this.code === 'conflict'
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
 * since the plan recorded it. Another apply cannot move it in between (the write phase holds the
 * workspace's apply lease), but a UI edit can still land between this re-read and the write: only
 * files (`expectedRevision`) and workflows (re-checked under the row lock) close that gap.
 */
export function assertUnchanged(change: PlannedChange, current: string): void {
  if (change.storedFingerprint !== undefined && current !== change.storedFingerprint) {
    throw new ResourceChangedError(change)
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
 * Whether `error` is a use case refusing the request, as opposed to a failure of the server or
 * something it depends on (`internal`, or `unavailable`: an outage answers 503, never the
 * caller's fault).
 */
export function isRefusal(error: unknown): error is OrchestrationError {
  return (
    error instanceof OrchestrationError && error.code !== 'internal' && error.code !== 'unavailable'
  )
}

/** What to do about a name or key another resource holds, by what holds it and where it is declared. */
function nameTakenHint(error: unknown, kind: WorkspaceKind): string {
  if (error instanceof ResourceKeyTakenError) {
    return 'Rename the key, or delete the resource that holds it.'
  }
  if (error instanceof WorkspaceFileFolderConflictError) {
    return 'Rename that folder in the file paths locally, or rename or delete the folder that holds the name in Sim.'
  }
  // A file has no declaration: its name is its path in the directory.
  if (kind === 'file') {
    return 'Rename it locally, or rename or delete the file that holds the name in Sim.'
  }
  return 'Rename it in its declaration, or rename or delete the resource that holds the name in Sim.'
}

/**
 * A child use case's refusal as a finding about one resource: a resource (or a table's rows)
 * changed since the plan read it is `E_APPLY_STALE`, forbidden is `E_APPLY_FORBIDDEN`,
 * locked `E_APPLY_LOCKED`, over a size limit `E_LIMIT_EXCEEDED` (so the refusal stays a `413`),
 * a taken key or a name a use case reports taken `E_NAME_TAKEN`, any
 * other expected failure (another conflict included) `E_APPLY_REFUSED` with its message.
 * Anything else (a database, network or dependency failure) is rethrown, never reported as the
 * caller's fault.
 */
export function refusalDiagnostic(
  error: unknown,
  resource: { kind: WorkspaceKind; key?: string }
): WorkspaceSourceDiagnostic {
  if (
    error instanceof ResourceChangedError ||
    error instanceof WorkflowSourceStaleError ||
    error instanceof TableRowsChangedError
  ) {
    return finding('E_APPLY_STALE', getErrorMessage(error), { hint: GET_HINT, ...resource })
  }
  if (error instanceof WorkflowSourceNameTakenError && resource.key !== undefined) {
    // Workflow folders are not placed in a folder by source, so the use case's "or in another
    // folder" is advice a directory cannot follow.
    const file = `${workflowFolder(resource.key)}/${SOURCE_ENTRY_FILE}`
    return finding(
      'E_NAME_TAKEN',
      `A workflow named ${JSON.stringify(error.workflowName)} already exists in the folder this workflow is saved to.`,
      {
        hint: `Rename the workflow in ${file}, or rename, move or delete the one that holds the name in Sim.`,
        file,
        ...resource,
      }
    )
  }
  if (error instanceof ResourceKeyTakenError || isNameTaken(error)) {
    return finding('E_NAME_TAKEN', error.message, {
      hint: nameTakenHint(error, resource.kind),
      ...resource,
    })
  }
  if (!isRefusal(error)) throw error
  const message = getErrorMessage(error)
  switch (error.code) {
    case 'forbidden':
    case 'unauthorized':
      return finding('E_APPLY_FORBIDDEN', message, resource)
    case 'locked':
      return finding('E_APPLY_LOCKED', message, resource)
    case 'payload_too_large':
      return finding('E_LIMIT_EXCEEDED', message, resource)
    default:
      return finding('E_APPLY_REFUSED', message, resource)
  }
}
