import type { DiagnosticCode } from '@sim/workflow-code'
import {
  boundDiagnostics,
  type DiagnosticSeverity,
  findingsTruncated,
  refusalClass,
} from '@sim/workflow-code/diagnostics'

/** The fields of a workflow source finding the bound reads. */
interface SourceFinding {
  code: DiagnosticCode
  severity: DiagnosticSeverity
  message: string
  hint?: string
}

/** The `I_FINDINGS_TRUNCATED` that ends a cut list. */
type TruncationFinding = ReturnType<typeof findingsTruncated>

/**
 * Workflow source findings as one answer lists them: bounded once, here at the edge, whichever
 * stages (compile, canonicalize, print, materialize, lint, gates) they came from, and ending in
 * one `I_FINDINGS_TRUNCATED` when cut (`boundDiagnostics`). Errors that class a refusal (stale,
 * too large) are kept first, so a cut list still shows why its status is what it is.
 */
export function boundSourceFindings<D extends SourceFinding>(
  findings: readonly D[]
): Array<D | TruncationFinding> {
  return boundDiagnostics(findings, {
    marker: findingsTruncated,
    first: (finding) => refusalClass([finding.code]) !== 'validation',
  })
}

/** `result` with its `diagnostics` bounded for the answer (see {@link boundSourceFindings}). */
export function withBoundSourceFindings<R extends { diagnostics: readonly SourceFinding[] }>(
  result: R
): Omit<R, 'diagnostics'> & { diagnostics: Array<R['diagnostics'][number] | TruncationFinding> } {
  return { ...result, diagnostics: boundSourceFindings(result.diagnostics) }
}
