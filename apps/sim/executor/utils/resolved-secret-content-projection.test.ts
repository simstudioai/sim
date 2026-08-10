/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createResolvedSecretMatcher,
  isResolvedSecretModelContentUnchanged,
  projectResolvedSecretContent,
  projectResolvedSecretDiagnosticError,
  projectResolvedSecretModelContent,
  projectResolvedSecretModelJsonContent,
  projectResolvedSecretModelJsonStrings,
} from '@/executor/utils/resolved-secret-content-projection'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

describe('projectResolvedSecretModelContent', () => {
  it('projects activated literals in values, keys, errors, and output streams', () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'API_KEY',
        plaintext: 'quoted"secret\\with\nnewline',
        encryptedValue: 'encrypted-value',
      },
    ])
    registry.recordResolved('API_KEY', 'quoted"secret\\with\nnewline')
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

  it('ignores sibling pending work but fails closed for permanent or missing registry state', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')
    const finish = registry.beginPendingActivation()

    expect(projectResolvedSecretModelContent('secret-value', registry)).toEqual({
      safe: true,
      value: '{{TOKEN}}',
    })

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
    registry.recordResolved('TOKEN', 'secret-value')

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

  it('does not apply provenance traversal limits when no secret was active', () => {
    const registry = new ResolvedSecretTraceRegistry()
    const value = new Array<null>(100_001).fill(null)

    const projection = projectResolvedSecretModelContent(value, registry)
    expect(projection.safe).toBe(true)
    if (projection.safe) expect(projection.value).toBe(value)
    expect(isResolvedSecretModelContentUnchanged(value, registry)).toBe(true)

    const jsonProjection = projectResolvedSecretModelJsonContent(value, registry)
    expect(jsonProjection.safe).toBe(true)
    if (jsonProjection.safe) {
      expect(jsonProjection.value).toHaveLength(value.length)
      expect((jsonProjection.value as null[]).at(-1)).toBeNull()
      expect(jsonProjection.value).not.toBe(value)
    }

    const jsonString = '{\n  "preserve": true\n}'
    expect(projectResolvedSecretModelJsonStrings([jsonString, undefined], registry)).toEqual({
      safe: true,
      value: [jsonString, undefined],
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
    registry.recordResolved('Test', 'Test')
    registry.recordResolved('COMPOSITE', 'x{{Test}}y')

    expect(projectResolvedSecretModelContent('x{{Test}}y', registry)).toEqual({
      safe: true,
      value: '{{COMPOSITE}}',
    })
  })

  it('projects exact typed numeric secrets, leaving booleans and null identifying nothing', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'NUMBER', plaintext: '123', encryptedValue: 'number-ciphertext' },
      { name: 'BOOLEAN', plaintext: 'true', encryptedValue: 'boolean-ciphertext' },
      { name: 'NULL', plaintext: 'null', encryptedValue: 'null-ciphertext' },
    ])
    registry.recordResolved('NUMBER', '123')
    registry.recordResolved('BOOLEAN', 'true')
    registry.recordResolved('NULL', 'null')

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
        strings: ['{{NUMBER}}', 'true', 'null'],
        number: '{{NUMBER}}',
        boolean: true,
        nothing: null,
        unrelatedNumber: 1234,
        unrelatedBoolean: false,
      },
    })
  })

  it.each(['123'])('keeps projected JSON argument strings valid (%s)', (secret) => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', secret)
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

  it('leaves a boolean-valued secret in a JSON argument string untouched', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'true', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'true')

    const projection = projectResolvedSecretModelJsonStrings(
      [JSON.stringify({ secret: 'true', converted: true, nested: [true] })],
      registry
    )

    expect(projection.safe).toBe(true)
    if (!projection.safe || !Array.isArray(projection.value)) return
    expect(JSON.parse(projection.value[0] as string)).toEqual({
      secret: 'true',
      converted: true,
      nested: [true],
    })
  })

  it('is stable when a secret literal overlaps its own provenance alias', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'TOKEN', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'TOKEN')

    const first = projectResolvedSecretModelContent('Bearer TOKEN', registry)
    expect(first).toEqual({ safe: true, value: 'Bearer {{TOKEN}}' })
    if (!first.safe) return
    expect(projectResolvedSecretModelContent(first.value, registry)).toEqual(first)
  })

  it('preserves the canonical provenance label when its name equals the secret plaintext', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'Test', plaintext: 'Test', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('Test', 'Test')

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
        result: '{{Test}}',
        source: 'return {{Test}}',
        error: "NameError: name '{{Test}}' is not defined",
      },
    })
  })

  it('atomically projects the selected provenance label when its name contains the value', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'TOK', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'TOK')

    expect(projectResolvedSecretModelContent('Bearer {{TOKEN}}', registry)).toEqual({
      safe: true,
      value: 'Bearer {{TOKEN}}',
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

  it('keeps provenance-shaped content deterministic without trusting it as a protocol handle', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'Test', plaintext: 'Test', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('Test', 'Test')

    expect(projectResolvedSecretModelContent('{{Test}}', registry)).toEqual({
      safe: true,
      value: '{{Test}}',
    })
    expect(isResolvedSecretModelContentUnchanged('{{Test}}', registry)).toBe(false)
    expect(isResolvedSecretModelContentUnchanged(['resource', '{{Test}}'], registry)).toBe(false)
    expect(isResolvedSecretModelContentUnchanged(['resource', 'safe'], registry)).toBe(true)
  })
})

describe('projectResolvedSecretModelJsonContent', () => {
  it('normalizes dates using their JSON wire representation', () => {
    const registry = new ResolvedSecretTraceRegistry()
    const createdAt = new Date('2026-08-05T12:34:56.789Z')

    expect(projectResolvedSecretModelJsonContent({ createdAt }, registry)).toEqual({
      safe: true,
      value: { createdAt: '2026-08-05T12:34:56.789Z' },
    })
    expect(createdAt).toBeInstanceOf(Date)
  })

  it('projects active secrets emitted by toJSON after materialization', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TOKEN', 'secret-value')

    expect(
      projectResolvedSecretModelJsonContent(
        {
          toJSON: () => ({ authorization: 'Bearer secret-value' }),
        },
        registry
      )
    ).toEqual({
      safe: true,
      value: { authorization: 'Bearer {{TOKEN}}' },
    })
  })

  it('does not invoke JSON serialization when provenance is incomplete', () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete()
    const toJSON = vi.fn(() => ({ value: 'untrusted' }))

    expect(projectResolvedSecretModelJsonContent({ toJSON }, registry)).toEqual({ safe: false })
    expect(toJSON).not.toHaveBeenCalled()
  })

  it('uses native JSON semantics for undefined and non-finite numbers', () => {
    const registry = new ResolvedSecretTraceRegistry()

    expect(
      projectResolvedSecretModelJsonContent(
        {
          omitted: undefined,
          undefinedInArray: [undefined],
          nan: Number.NaN,
          infinities: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
        },
        registry
      )
    ).toEqual({
      safe: true,
      value: {
        undefinedInArray: [null],
        nan: null,
        infinities: [null, null],
      },
    })
  })

  it('returns a controlled unsafe result for values JSON cannot serialize', () => {
    const registry = new ResolvedSecretTraceRegistry()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic

    expect(projectResolvedSecretModelJsonContent(cyclic, registry)).toEqual({ safe: false })
    expect(projectResolvedSecretModelJsonContent({ value: 1n }, registry)).toEqual({ safe: false })
  })

  it('enforces the byte limit after secret aliases are projected', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'X', plaintext: 'x', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('X', 'x')

    expect(projectResolvedSecretModelJsonContent({ a: 'x' }, registry, 9)).toEqual({ safe: false })
  })
})

describe('projectResolvedSecretDiagnosticError', () => {
  it('projects plaintext and internal aliases without mutating the runtime error', () => {
    const secret = 'diagnostic-secret-value'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: secret, encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('API_KEY', secret)
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

  it('sanitizes an inactive compiler alias without activating or scanning its secret', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'X', plaintext: 'x', encryptedValue: 'ciphertext' },
    ])
    const error = new Error('Box __var_X')

    expect(projectResolvedSecretDiagnosticError(error, registry)).toEqual(
      expect.objectContaining({ error: 'Box [REDACTED_SECRET]' })
    )
    expect(registry.getActiveMatches()).toEqual([])
  })

  it('lexically sanitizes unknown and runtime-only aliases without catalog inference', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])

    expect(
      projectResolvedSecretDiagnosticError(new Error('secret-value __var_UNKNOWN'), registry)
    ).toEqual(expect.objectContaining({ error: 'secret-value [REDACTED_SECRET]' }))
    expect(
      projectResolvedSecretDiagnosticError(
        new Error('secret-value __sim_code_1_binding_0'),
        registry
      )
    ).toEqual(expect.objectContaining({ error: 'secret-value [RUNTIME_BINDING]' }))
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

describe('literals too small to identify anything', () => {
  const matcher = createResolvedSecretMatcher(
    [
      { plaintext: 'false', replacement: '{{BANNER_ENABLED}}' },
      { plaintext: 'xoxb-real-secret-value', replacement: '{{SLACK_TOKEN}}' },
    ],
    { preserveNamedProvenanceLabels: true, mode: 'render' }
  )!

  const project = (value: unknown) =>
    projectResolvedSecretContent(value, matcher, 1_000_000, { projectPrimitiveLiterals: true })

  /** A `*_ENABLED` variable holding `false` once rewrote 2,000 boolean cells in one table read. */
  it('leaves a typed boolean cell alone', () => {
    expect(project({ had_error: false, ok: true, missing: null })).toEqual({
      safe: true,
      value: { had_error: false, ok: true, missing: null },
    })
  })

  it('leaves a delimited occurrence inside surrounding text alone', () => {
    expect(project({ url: 'https://x?fromUser=false&sort=count' })).toEqual({
      safe: true,
      value: { url: 'https://x?fromUser=false&sort=count' },
    })
  })

  it('still substitutes a real secret sharing the same matcher', () => {
    expect(project({ token: 'xoxb-real-secret-value', flag: false })).toEqual({
      safe: true,
      value: { token: '{{SLACK_TOKEN}}', flag: false },
    })
  })

  it('builds no matcher at all when every literal is non-identifying', () => {
    expect(
      createResolvedSecretMatcher([{ plaintext: 'true', replacement: '{{FLAG}}' }], {
        mode: 'render',
      })
    ).toBeUndefined()
  })
})
