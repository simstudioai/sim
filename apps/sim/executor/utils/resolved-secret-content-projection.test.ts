/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  isResolvedSecretModelContentUnchanged,
  projectResolvedSecretDiagnosticError,
  projectResolvedSecretModelContent,
  projectResolvedSecretModelJsonStrings,
} from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('projectResolvedSecretModelContent', () => {
  it('projects dormant catalog literals in values, keys, errors, and output streams', () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'API_KEY',
        plaintext: 'quoted"secret\\with\nnewline',
        encryptedValue: 'encrypted-value',
      },
    ])
    const input = {
      'key-quoted"secret\\with\nnewline': {
        name: 'Error',
        message: 'failed: quoted"secret\\with\nnewline',
        stack: 'stack near quoted"secret\\with\nnewline',
      },
      stdout: 'Bearer quoted"secret\\with\nnewline',
      stderr: ['quoted"secret\\with\nnewline'],
      serialized: JSON.stringify({ token: 'quoted"secret\\with\nnewline' }),
    }

    const projection = projectResolvedSecretModelContent(input, registry)

    expect(projection).toEqual({
      safe: true,
      value: {
        'key-{{API_KEY}}': {
          name: 'Error',
          message: 'failed: {{API_KEY}}',
          stack: 'stack near {{API_KEY}}',
        },
        stdout: 'Bearer {{API_KEY}}',
        stderr: ['{{API_KEY}}'],
        serialized: JSON.stringify({ token: '{{API_KEY}}' }),
      },
    })
    expect(JSON.stringify(input)).toContain('quoted\\"secret')
  })

  it('fails closed for pending, permanent, or missing registry state', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    const finish = registry.beginPendingActivation()

    expect(projectResolvedSecretModelContent('secret-value', registry)).toEqual({ safe: false })

    finish()
    expect(projectResolvedSecretModelContent('secret-value', registry)).toEqual({
      safe: true,
      value: '{{TOKEN}}',
    })

    registry.markIncomplete()
    expect(projectResolvedSecretModelContent('secret-value', registry)).toEqual({ safe: false })
    expect(projectResolvedSecretModelContent('secret-value', undefined)).toEqual({ safe: false })
  })

  it('never emits internal runtime binding aliases', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])

    const projection = projectResolvedSecretModelContent(
      { value: 'secret-value', internal: '__var_TOKEN' },
      registry
    )

    expect(projection).toEqual({
      safe: true,
      value: { value: '{{TOKEN}}', internal: '{{TOKEN}}' },
    })
    expect(JSON.stringify(projection)).not.toContain('secret-value')
    expect(JSON.stringify(projection)).not.toContain('__var_')
  })

  it('preserves foreign internal-looking text that the execution did not register', () => {
    const registry = new ResolvedSecretTraceRegistry()

    const projection = projectResolvedSecretModelContent(
      {
        legacy: '__var_FOREIGN_KEY',
        binding: '__sim_code_12_binding_3',
        marker: '__sim_code_12_binding_3_marker_a__',
        privateInput: '__sim_code_2_input_0',
        runtimeBinding: '__sim_code_4_runtime_0',
        runtime: '__sim_runtime_payload_4',
        path: '__SIM_RUNTIME_PAYLOAD_PATH',
      },
      registry
    )

    expect(projection).toEqual({
      safe: true,
      value: {
        legacy: '__var_FOREIGN_KEY',
        binding: '__sim_code_12_binding_3',
        marker: '__sim_code_12_binding_3_marker_a__',
        privateInput: '__sim_code_2_input_0',
        runtimeBinding: '__sim_code_4_runtime_0',
        runtime: '__sim_runtime_payload_4',
        path: '__SIM_RUNTIME_PAYLOAD_PATH',
      },
    })
    expect(isResolvedSecretModelContentUnchanged('__var_FOREIGN_KEY', registry)).toBe(true)
    expect(isResolvedSecretModelContentUnchanged('__sim_code_12_binding_3', registry)).toBe(true)
  })

  it('preserves an unregistered opaque-placeholder-shaped literal', () => {
    const registry = new ResolvedSecretTraceRegistry()

    expect(projectResolvedSecretModelContent('{{[REDACTED_SECRET]}}', registry)).toEqual({
      safe: true,
      value: '{{[REDACTED_SECRET]}}',
    })
  })

  it('keeps longest-match semantics when a known opaque placeholder is nested in a secret', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'Test', plaintext: 'Test', encryptedValue: 'test-ciphertext' },
      {
        name: 'COMPOSITE',
        plaintext: 'x{{Test}}y',
        encryptedValue: 'composite-ciphertext',
      },
    ])

    expect(projectResolvedSecretModelContent('x{{Test}}y', registry)).toEqual({
      safe: true,
      value: '{{COMPOSITE}}',
    })
  })

  it('projects exact typed primitive secrets without rewriting unrelated primitives', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'NUMBER', plaintext: '123', encryptedValue: 'number-ciphertext' },
      { name: 'BOOLEAN', plaintext: 'true', encryptedValue: 'boolean-ciphertext' },
      { name: 'NULL', plaintext: 'null', encryptedValue: 'null-ciphertext' },
    ])

    expect(
      projectResolvedSecretModelContent(
        {
          strings: ['123', 'true', 'null'],
          number: 123,
          boolean: true,
          nothing: null,
          unrelatedNumber: 1234,
          unrelatedBoolean: false,
        },
        registry
      )
    ).toEqual({
      safe: true,
      value: {
        strings: ['{{NUMBER}}', '{{BOOLEAN}}', '{{NULL}}'],
        number: '{{NUMBER}}',
        boolean: '{{BOOLEAN}}',
        nothing: '{{NULL}}',
        unrelatedNumber: 1234,
        unrelatedBoolean: false,
      },
    })
  })

  it.each(['123', 'true'])('keeps projected JSON argument strings valid (%s)', (secret) => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    const typedValue = secret === '123' ? 123 : true

    const projection = projectResolvedSecretModelJsonStrings(
      [JSON.stringify({ secret, converted: typedValue, nested: [typedValue] })],
      registry
    )

    expect(projection.safe).toBe(true)
    if (!projection.safe || !Array.isArray(projection.value)) return
    expect(JSON.parse(projection.value[0] as string)).toEqual({
      secret: '{{TOKEN}}',
      converted: '{{TOKEN}}',
      nested: ['{{TOKEN}}'],
    })
  })

  it('is stable when a secret literal overlaps its own provenance alias', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'TOKEN', encryptedValue: 'ciphertext' },
    ])

    const first = projectResolvedSecretModelContent('Bearer TOKEN', registry)
    expect(first).toEqual({ safe: true, value: 'Bearer [REDACTED_SECRET]' })
    if (!first.safe) return
    expect(projectResolvedSecretModelContent(first.value, registry)).toEqual(first)
  })

  it('uses opaque model projection when a provenance label contains the secret plaintext', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'Test', plaintext: 'Test', encryptedValue: 'ciphertext' },
    ])

    expect(
      projectResolvedSecretModelContent(
        {
          result: 'Test',
          source: 'return {{Test}}',
          error: "NameError: name 'Test' is not defined",
        },
        registry
      )
    ).toEqual({
      safe: true,
      value: {
        result: '[REDACTED_SECRET]',
        source: 'return [REDACTED_SECRET]',
        error: "NameError: name '[REDACTED_SECRET]' is not defined",
      },
    })
  })

  it('atomically projects the selected provenance label when its name contains the value', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'TOK', encryptedValue: 'ciphertext' },
    ])

    expect(projectResolvedSecretModelContent('Bearer {{TOKEN}}', registry)).toEqual({
      safe: true,
      value: 'Bearer [REDACTED_SECRET]',
    })
  })

  it('fails closed when provenance-derived matcher patterns exceed capacity', () => {
    const registry = new ResolvedSecretTraceRegistry()
    const getModelEgressSnapshot = vi.spyOn(registry, 'getModelEgressSnapshot').mockReturnValue({
      complete: true,
      matches: [
        {
          plaintext: 'x'.repeat(64 * 1024),
          replacement: '[REDACTED_SECRET]',
        },
      ],
    })

    expect(projectResolvedSecretModelContent('safe', registry)).toEqual({ safe: false })
    expect(projectResolvedSecretModelContent('still-safe', registry)).toEqual({ safe: false })
    expect(getModelEgressSnapshot).toHaveBeenCalledOnce()
  })

  it('does not treat attacker-authored provenance-shaped protocol content as unchanged', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'Test', plaintext: 'Test', encryptedValue: 'ciphertext' },
    ])

    expect(isResolvedSecretModelContentUnchanged('{{Test}}', registry)).toBe(false)
    expect(isResolvedSecretModelContentUnchanged(['resource', '{{Test}}'], registry)).toBe(false)
    expect(isResolvedSecretModelContentUnchanged(['resource', 'safe'], registry)).toBe(true)
  })
})

describe('projectResolvedSecretDiagnosticError', () => {
  it('projects plaintext and internal aliases without mutating the runtime error', () => {
    const secret = 'diagnostic-secret-value'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    const message = `request failed: ${secret} __var_API_KEY __sim_code_4_binding_2`
    const error = new Error(message)
    error.stack = `Error: ${message}\n at __sim_runtime_payload_1`

    const diagnostic = projectResolvedSecretDiagnosticError(error, registry, {
      cause: { message: `nested ${secret}` },
    })

    expect(error.message).toBe(message)
    expect(error.stack).toContain(secret)
    expect(diagnostic).toEqual({
      cause: { message: 'nested {{API_KEY}}' },
      error: 'request failed: {{API_KEY}} {{API_KEY}} [RUNTIME_BINDING]',
      errorName: 'Error',
      stack:
        'Error: request failed: {{API_KEY}} {{API_KEY}} [RUNTIME_BINDING]\n at [RUNTIME_BINDING]',
    })
  })

  it('falls back to text-free structure when provenance is missing or incomplete', () => {
    const error = new Error('secret __var_API_KEY')
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete()

    expect(projectResolvedSecretDiagnosticError(error, undefined)).toEqual({
      errorType: 'error',
      hasStack: true,
    })
    expect(projectResolvedSecretDiagnosticError(error, registry)).toEqual({
      errorType: 'error',
      hasStack: true,
    })
  })
})
