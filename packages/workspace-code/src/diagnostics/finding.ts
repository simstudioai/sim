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

/** Spans and code frames in one file, splitting its lines once however many it locates. */
interface SourceLocator {
  /** The span of `[start, end)`, with 1-based lines and columns. */
  span(start: number, end: number): SourceSpan
  /** `span` with its code frame. */
  located(span: SourceSpan): { span: SourceSpan; frame: string }
}

/**
 * Locates offsets in one file. The lines and their start offsets are computed once, so each span
 * is a binary search: a reader that spans every value of a large file stays linear.
 */
export function sourceLocator(file: string, text: string): SourceLocator {
  const lines = splitLines(text)
  const starts: number[] = []
  let offset = 0
  for (const line of lines) {
    starts.push(offset)
    offset += line.length
    offset += text.charCodeAt(offset) === 13 && text.charCodeAt(offset + 1) === 10 ? 2 : 1
  }
  const position = (at: number) => {
    const clamped = Math.max(0, Math.min(at, text.length))
    let low = 0
    let high = starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if (starts[middle] <= clamped) low = middle
      else high = middle - 1
    }
    return { line: low + 1, column: clamped - starts[low] + 1 }
  }
  return {
    span(start, end) {
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
    },
    located: (span) => ({ span, frame: codeFrame(lines, span) }),
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
