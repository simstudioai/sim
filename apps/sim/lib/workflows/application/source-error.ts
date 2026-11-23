import type { DiagnosticCode } from '@sim/workflow-code'
import type { DiagnosticSeverity } from '@sim/workflow-code/diagnostics'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/**
 * One finding from applying workflow source, flattened for the wire: the compile span becomes
 * `file`/`line`/`column` and its code frame. Lines refer to the submitted files.
 */
export interface WorkflowSourceDiagnostic {
  code: DiagnosticCode
  severity: DiagnosticSeverity
  message: string
  hint?: string
  file?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  /** A plain-text excerpt of the submitted file around `line`, with a caret row. */
  frame?: string
  blockKey?: string
  blockId?: string
  param?: string
  /** JSON Pointer into a non-source input, such as the lock (`/blocks/agent/ident`). */
  path?: string
}

/**
 * Submitted workflow source that cannot be applied: a compile error, a gate refusal, a locked
 * block, an invalid value or a blocking lint finding. Nothing was written. A source refused for
 * exceeding a size limit (`E_LIMIT_EXCEEDED`) is `payload_too_large` (413), like the body cap;
 * anything else is `validation` (400). Kept apart from the use case so a route error policy can
 * narrow on it without importing the compiler.
 */
export class WorkflowSourceRejectedError extends OrchestrationError {
  constructor(readonly diagnostics: WorkflowSourceDiagnostic[]) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    super(
      errors.some((diagnostic) => diagnostic.code === 'E_LIMIT_EXCEEDED')
        ? 'payload_too_large'
        : 'validation',
      `The workflow source has ${errors.length} error(s); nothing was written. See details.diagnostics.`
    )
    this.name = 'WorkflowSourceRejectedError'
  }
}

/**
 * The stored draft no longer matches the fingerprint the source was read at: someone
 * edited the workflow, toggled a block lock, or a migration changed it. Re-read the source,
 * rebase the edit onto it and apply again.
 */
/**
 * Why a source apply refuses a draft changed since its base, as both its 409 and dry run say,
 * naming the workflow so a workspace apply's line for it says which one.
 */
export function workflowSourceStaleMessage(workflowName: string): string {
  return `Workflow ${JSON.stringify(workflowName)} changed since this source was read. Get the source again, reapply your edit and retry.`
}

export class WorkflowSourceStaleError extends OrchestrationError {
  constructor(
    readonly currentFingerprint: string,
    workflowName: string
  ) {
    super('conflict', workflowSourceStaleMessage(workflowName))
    this.name = 'WorkflowSourceStaleError'
  }
}

/**
 * A workflow created from source would take a name another live workflow already has in the
 * target folder. Not a stale read: getting the source again cannot fix it. Pass another name
 * or folder, or rename the existing workflow.
 */
export class WorkflowSourceNameTakenError extends OrchestrationError {
  constructor(readonly workflowName: string) {
    super(
      'conflict',
      `A workflow named "${workflowName}" already exists in this folder. Create it under another name or in another folder.`
    )
    this.name = 'WorkflowSourceNameTakenError'
  }
}
