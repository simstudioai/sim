/**
 * The Platform checks grant exceptions through allowlists keyed by module path. Each entry maps to
 * the one-line reason it was granted, so an exception states why it exists where it is declared and
 * a reviewer can judge whether that reason still holds.
 */
export type ReasonedAllowlist = Readonly<Record<string, string>>

/** The entries of each named allowlist whose reason is missing or spans more than one line. */
export function allowlistReasonFindings(
  allowlists: Readonly<Record<string, ReasonedAllowlist>>
): string[] {
  const findings: string[] = []
  for (const [name, entries] of Object.entries(allowlists)) {
    for (const [entry, reason] of Object.entries(entries)) {
      if (typeof reason !== 'string' || !reason.trim()) {
        findings.push(`${name} grants ${entry} without a reason`)
      } else if (/[\r\n]/.test(reason)) {
        findings.push(`${name} gives ${entry} a reason longer than one line`)
      }
    }
  }
  return findings
}
