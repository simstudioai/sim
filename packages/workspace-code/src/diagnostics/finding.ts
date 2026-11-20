import {
  codeFrame,
  type DiagnosticCode,
  type DiagnosticFields,
  LineIndex,
  type SourceSpan,
} from '@sim/workflow-code'
import {
  type AnswerBound,
  boundFindingText,
  type DiagnosticSeverity,
  type SeverityOf,
  diagnostic as sharedDiagnostic,
} from '@sim/workflow-code/diagnostics'
import type { WorkspaceKind } from '../kind'
import { refusalClass, type WorkspaceDiagnosticCode } from './codes'

/** The resource a finding is about: the CLI joins a finding to its planned change by both. */
export interface FindingResource {
  kind: WorkspaceKind
  key: string
}

/** The {@link FindingResource} of `kind`'s resource `key`. */
export function resourceOf(kind: WorkspaceKind, key: string): FindingResource {
  return { kind, key }
}

/** The resource a finding is about, beside where in its files. */
type ResourceFields = Partial<FindingResource>

/**
 * One workspace source finding. A union over codes, so `severity` always agrees with the code's
 * prefix, as `Diagnostic` does in `@sim/workflow-code`.
 */
export type WorkspaceDiagnostic<C extends WorkspaceDiagnosticCode = WorkspaceDiagnosticCode> =
  C extends WorkspaceDiagnosticCode
    ? DiagnosticFields & ResourceFields & { code: C; severity: SeverityOf<C> }
    : never

/** The optional fields of a finding. */
type DiagnosticExtras = Omit<DiagnosticFields, 'message'> & ResourceFields

/**
 * Findings one declaration file lists; past it the file gets one `I_FINDINGS_TRUNCATED` and the rest
 * are dropped, so a file of bad values costs no more than its first hundred.
 */
export const MAX_FINDINGS_PER_FILE = 100

/** The finding that ends a file's list at {@link MAX_FINDINGS_PER_FILE}. */
export function findingLimitReached(extras: DiagnosticExtras = {}): WorkspaceDiagnostic {
  return diagnostic(
    'I_FINDINGS_TRUNCATED',
    `Stopped after ${MAX_FINDINGS_PER_FILE} findings in this file.`,
    { ...extras, hint: 'Fix these and apply again to see the rest.' }
  )
}

/**
 * A workspace finding with its severity filled in from the code. Its message and hint are cut as
 * the compile cuts its own (`boundFindingText`): a limit that stops work, so a finding never holds
 * more of the source it quotes (a 50 KB key, a hundred times in one file) than an answer could show.
 */
export function diagnostic<C extends WorkspaceDiagnosticCode>(
  code: C,
  message: string,
  extras: DiagnosticExtras = {}
): WorkspaceDiagnostic<C> {
  return boundFindingText(sharedDiagnostic(code, message, extras)) as WorkspaceDiagnostic<C>
}

/**
 * How one workspace answer bounds its findings (`boundAnswerFindings`): at most 1,000, errors
 * first and those of a classed refusal (stale, locked, too large) first of all, then warnings,
 * then infos. No per-severity or per-code cap: a status reads every server-change finding of the
 * resources it lists.
 */
export const WORKSPACE_ANSWER_BOUND: AnswerBound = {
  limits: {
    total: 1_000,
    perSeverity: Number.POSITIVE_INFINITY,
    warningsPerCode: Number.POSITIVE_INFINITY,
  },
  classify: refusalClass,
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
  const index = new LineIndex(text)
  return {
    span(start, end) {
      const from = index.position(start)
      const to = index.position(end)
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
    located: (span) => ({ span, frame: codeFrame(index.lines, span) }),
  }
}

/** The span of a whole file: where a finding about a file rather than a value in it points. */
export function wholeFile(file: string): SourceSpan {
  return { file, line: 1, column: 1, endLine: 1, endColumn: 1, start: 0, end: 0 }
}

/**
 * A finding flattened for the wire: the span becomes `file`/`line`/`column`, as workflow source
 * diagnostics travel.
 */
export interface FlatDiagnostic {
  /** A workspace code, or a workflow folder's own (the workflow pipeline's codes). */
  code: WorkspaceDiagnosticCode | DiagnosticCode
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
  kind?: WorkspaceKind
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
