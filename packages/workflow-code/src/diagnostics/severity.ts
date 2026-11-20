/**
 * How a finding weighs, in every vocabulary (workflow and workspace source): an error refuses, a
 * warning and an info only report. A code's first letter fixes it (`E_`, `W_`, `I_`), so a
 * finding never carries a severity its code disagrees with.
 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info'

/** The severity a code's prefix fixes. */
export type SeverityOf<C extends string> = C extends `E_${string}`
  ? 'error'
  : C extends `W_${string}`
    ? 'warning'
    : 'info'

/** The severity of any code, by its prefix. */
export function severityOf<C extends string>(code: C): SeverityOf<C> {
  return (
    code.startsWith('E_') ? 'error' : code.startsWith('W_') ? 'warning' : 'info'
  ) as SeverityOf<C>
}
