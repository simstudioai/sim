import { codeFrame, type DiagnosticFields, type SourceSpan, splitLines } from '@sim/workflow-code'
import {
  type DiagnosticSeverity,
  type SeverityOfCode,
  severityOf,
  type WorkspaceDiagnosticCode,
} from './codes'

/** The resource a finding is about, beside where in its files. */
interface ResourceFields {
  kind?: string
  key?: string
}

/**
 * One workspace source finding. A union over codes, so `severity` always agrees with the code's
 * prefix, as `Diagnostic` does in `@sim/workflow-code`.
 */
export type WorkspaceDiagnostic<C extends WorkspaceDiagnosticCode = WorkspaceDiagnosticCode> =
  C extends WorkspaceDiagnosticCode
    ? DiagnosticFields & ResourceFields & { code: C; severity: SeverityOfCode<C> }
    : never

/** The optional fields of a finding. */
export type DiagnosticExtras = Omit<DiagnosticFields, 'message'> & ResourceFields

/** A finding with its severity filled in from the code. */
export function diagnostic<C extends WorkspaceDiagnosticCode>(
  code: C,
  message: string,
  extras: DiagnosticExtras = {}
): WorkspaceDiagnostic<C> {
  return { ...extras, code, message, severity: severityOf(code) } as WorkspaceDiagnostic<C>
}

/** `span` with its code frame, for a finding pinned to `text`. */
export function located(text: string, span: SourceSpan): { span: SourceSpan; frame: string } {
  return { span, frame: codeFrame(text, span) }
}

/** The span of `[start, end)` in `text`, with 1-based lines and columns. */
export function spanAt(file: string, text: string, start: number, end: number): SourceSpan {
  const position = (offset: number) => {
    const before = text.slice(0, Math.max(0, Math.min(offset, text.length)))
    const lines = splitLines(before)
    return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 }
  }
  const from = position(start)
  const to = position(end)
  return {
    file,
    line: from.line,
    column: from.column,
    endLine: to.line,
    endColumn: to.column,
    start,
    end,
  }
}

/**
 * A finding flattened for the wire: the span becomes `file`/`line`/`column`, as workflow source
 * diagnostics travel.
 */
export interface FlatDiagnostic {
  code: string
  severity: DiagnosticSeverity
  message: string
  hint?: string
  file?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  frame?: string
  path?: string
  kind?: string
  key?: string
}

/** Flattens a finding's span onto `file`/`line`/`column`. */
export function flattenDiagnostic(finding: WorkspaceDiagnostic): FlatDiagnostic {
  const { span, frame, hint, path, kind, key } = finding
  return {
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    ...(hint !== undefined ? { hint } : {}),
    ...(span
      ? {
          file: span.file,
          line: span.line,
          column: span.column,
          endLine: span.endLine,
          endColumn: span.endColumn,
        }
      : {}),
    ...(frame !== undefined ? { frame } : {}),
    ...(path !== undefined ? { path } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(key !== undefined ? { key } : {}),
  }
}
