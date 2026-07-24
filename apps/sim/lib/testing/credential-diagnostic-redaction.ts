// Keep these patterns aligned with e2e/support/leak-canary.ts.
const CREDENTIAL_PATTERNS = [
  /sk-sim-[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g,
  /sim_(?!e2e_)[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g,
  /E2E_RUNTIME_SECRET_V1_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g,
] as const

export function redactCredentialDiagnostic(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  return CREDENTIAL_PATTERNS.reduce(
    (redacted, pattern) => redacted.replace(pattern, '[credential-redacted]'),
    value
  )
}
