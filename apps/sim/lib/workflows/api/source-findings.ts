import { boundAnswerFindings, type DiagnosticSeverity } from '@sim/workflow-code/diagnostics'

/** `result` with its `diagnostics` bounded for the answer (`boundAnswerFindings`). */
export function withBoundSourceFindings<
  R extends {
    diagnostics: ReadonlyArray<{
      code: string
      severity: DiagnosticSeverity
      message: string
      hint?: string
    }>
  },
>(result: R) {
  return { ...result, diagnostics: boundAnswerFindings(result.diagnostics) }
}
