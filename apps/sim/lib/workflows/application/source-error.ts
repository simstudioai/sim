import type { DiagnosticCode, DiagnosticSeverity } from '@sim/workflow-code'
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
 * block, an invalid value or a blocking lint finding. Nothing was written. Kept apart
 * from the use case so a route error policy can narrow on it without importing the compiler.
 */
export class WorkflowSourceRejectedError extends OrchestrationError {
  constructor(readonly diagnostics: WorkflowSourceDiagnostic[]) {
    const errors = diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length
    super(
      'validation',
      `The workflow source has ${errors} error(s); nothing was written. See details.diagnostics.`
    )
    this.name = 'WorkflowSourceRejectedError'
  }
}

/**
 * The stored draft no longer matches the fingerprint the source was read at: someone
 * edited the workflow, toggled a block lock, or a migration changed it. Re-read the source,
 * rebase the edit onto it and apply again.
 */
export class WorkflowSourceStaleError extends OrchestrationError {
  constructor(readonly currentFingerprint: string) {
    super(
      'conflict',
      'The workflow changed since this source was read. Get the source again, reapply your edit and retry.'
    )
    this.name = 'WorkflowSourceStaleError'
  }
}
