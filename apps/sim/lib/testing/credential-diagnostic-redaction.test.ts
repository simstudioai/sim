import { describe, expect, it } from 'vitest'
import { redactCredentialDiagnostic } from './credential-diagnostic-redaction'

describe('redactCredentialDiagnostic', () => {
  it('redacts complete credential values without removing surrounding diagnostics', () => {
    const token = Array.from({ length: 32 }, (_, index) =>
      String.fromCharCode('A'.charCodeAt(0) + (index % 26))
    ).join('')
    const diagnostic = [
      `input value: ${['sk', 'sim'].join('-')}-${token}`,
      `legacy value: ${['sim', ''].join('_')}${token}`,
      `runtime value: ${['E2E', 'RUNTIME', 'SECRET', 'V1'].join('_')}_${token}`,
    ].join('\n')

    expect(redactCredentialDiagnostic(diagnostic)).toBe(
      [
        'input value: [credential-redacted]',
        'legacy value: [credential-redacted]',
        'runtime value: [credential-redacted]',
      ].join('\n')
    )
  })

  it('does not redact masked, partial, or bounded non-credentials', () => {
    const token = 'A'.repeat(32)
    const diagnostic = [
      'sk-sim-••••••••',
      `sk-sim-${token.slice(0, 31)}`,
      `sk-sim-${token}A`,
      `sim_e2e_${token}`,
    ].join('\n')
    expect(redactCredentialDiagnostic(diagnostic)).toBe(diagnostic)
    expect(redactCredentialDiagnostic(undefined)).toBeUndefined()
  })
})
