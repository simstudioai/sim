/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { RunCode, RunFunction } from '@/lib/copilot/generated/tool-catalog-v1'
import {
  describeWithholdingCause,
  inspectToolResultForCopilot,
  projectToolResultForCopilot,
  READ_TOOL_RESULT_UNAVAILABLE_ERROR,
  TOOL_RESULT_UNAVAILABLE_ERROR,
  toolResultUnavailableError,
} from '@/lib/copilot/request/tools/resolved-secret-result'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

function createRegistry(): ResolvedSecretTraceRegistry {
  return new ResolvedSecretTraceRegistry([
    {
      name: 'SECRET',
      plaintext: 'secret-value',
      encryptedValue: 'encrypted-secret-value',
    },
  ])
}

describe('projectToolResultForCopilot', () => {
  it.each([RunFunction.id, RunCode.id])(
    'projects active exact and embedded secrets for %s without mutating runtime output',
    (toolName) => {
      const registry = createRegistry()
      registry.recordResolved('SECRET', 'secret-value', { propagated: true })
      const runtimeResult = {
        success: true,
        output: {
          result: 'secret-value',
          stdout: 'prefix-secret-value-suffix',
          values: ['safe', 'secret-value'],
        },
      }
      const runtimeSnapshot = structuredClone(runtimeResult)

      expect(projectToolResultForCopilot(runtimeResult, registry)).toEqual({
        success: true,
        output: {
          result: '{{SECRET}}',
          stdout: 'prefix-{{SECRET}}-suffix',
          values: ['safe', '{{SECRET}}'],
        },
      })
      expect(runtimeResult).toEqual(runtimeSnapshot)
    }
  )

  it('projects an exact-name/exact-value Function result to its named placeholder', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TestName', plaintext: 'TestName', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolved('TestName', 'TestName', { propagated: true })
    const runtimeResult = {
      success: true,
      output: {
        result: 'TestName',
        embedded: 'Bearer TestName',
        legacy: '__var_TestName',
        compiler: '__sim_code_0_binding_0',
      },
    }

    const projected = projectToolResultForCopilot(runtimeResult, registry)

    expect(projected).toEqual({
      success: true,
      output: {
        result: '{{TestName}}',
        embedded: 'Bearer {{TestName}}',
        legacy: '{{TestName}}',
        compiler: '__sim_code_0_binding_0',
      },
    })
    expect(JSON.stringify(projected)).not.toContain('"Test"')
    expect(JSON.stringify(projected)).not.toContain('__var_')
    expect(JSON.stringify(projected)).toContain('__sim_code_0_binding_0')
    expect(runtimeResult.output.result).toBe('TestName')
  })

  it('projects both output and error from a failed Function execution', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value', { propagated: true })

    expect(
      projectToolResultForCopilot(
        {
          success: false,
          output: { stdout: 'printed secret-value' },
          error: 'Function failed near secret-value',
        },
        registry
      )
    ).toEqual({
      success: false,
      output: { stdout: 'printed {{SECRET}}' },
      error: 'Function failed near {{SECRET}}',
    })
  })

  it('projects the model-only copy without mutating raw structural object keys', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value', { propagated: true })

    expect(
      projectToolResultForCopilot(
        {
          success: true,
          output: { 'prefix-secret-value': 'safe' },
        },
        registry
      )
    ).toEqual({
      success: true,
      output: { 'prefix-{{SECRET}}': 'safe' },
    })

    const raw = {
      success: true,
      output: { 'prefix-secret-value': 'safe' },
    }
    projectToolResultForCopilot(raw, registry)
    expect(raw.output).toEqual({ 'prefix-secret-value': 'safe' })

    expect(
      projectToolResultForCopilot(
        {
          success: true,
          output: { 'secret-value': 'first', '{{SECRET}}': 'second' },
        },
        registry
      )
    ).toEqual({ success: true })
  })

  it('uses an opaque marker when a replacement contains another active literal', () => {
    const middle = 'Kq7Xz2Lm9P'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'MIDDLE', plaintext: middle, encryptedValue: 'encrypted-middle' },
      { name: 'LABEL_PREFIX', plaintext: '{{MIDDLE', encryptedValue: 'encrypted-prefix' },
      { name: 'JOINED', plaintext: 'aaaacccc', encryptedValue: 'encrypted-ac' },
    ])
    registry.recordResolved('MIDDLE', middle, { propagated: true })
    registry.recordResolved('LABEL_PREFIX', '{{MIDDLE', { propagated: true })
    registry.recordResolved('JOINED', 'aaaacccc', { propagated: true })

    expect(
      projectToolResultForCopilot({ success: true, output: `aaaa${middle}cccc` }, registry)
    ).toEqual({ success: true, output: 'aaaa[REDACTED_SECRET]cccc' })
  })

  /**
   * The floor replaced a tier that substituted a short literal wherever it sat on a word boundary.
   * A six-character value is below the floor, so no position substitutes it any more — the accepted
   * cost of never rewriting an unrelated token that happens to share those bytes.
   */
  it('leaves a secret below the length floor alone in every position', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PIN', plaintext: '483920', encryptedValue: 'encrypted-pin' },
    ])
    registry.recordResolved('PIN', '483920', { propagated: true })

    expect(
      projectToolResultForCopilot(
        {
          success: true,
          output: {
            whole: '483920',
            delimited: 'code=483920',
            underscored: 'user_483920_profile',
            embedded: 'ref483920x',
          },
        },
        registry
      )
    ).toEqual({
      success: true,
      output: {
        whole: '483920',
        delimited: 'code=483920',
        underscored: 'user_483920_profile',
        embedded: 'ref483920x',
      },
    })
  })

  /** A one-character value cannot be hidden by substitution; an observer can enumerate ten. */
  it('leaves an active one-character value in keys and the control error alone', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'F_SECRET', plaintext: 'F', encryptedValue: 'encrypted-f' },
    ])
    registry.recordResolved('F_SECRET', 'F', { propagated: true })

    const projected = projectToolResultForCopilot(
      {
        success: false,
        output: { F: 'first', '': 'second' },
        error: 'F',
      },
      registry
    )

    expect(projected).toEqual({
      success: false,
      output: { F: 'first', '': 'second' },
      error: 'F',
    })
  })

  it('emits the fixed missing-error message without projecting it as runtime content', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'T_SECRET', plaintext: 'T', encryptedValue: 'encrypted-t' },
    ])
    registry.recordResolved('T_SECRET', 'T', { propagated: true })

    expect(projectToolResultForCopilot({ success: false }, registry)).toEqual({
      success: false,
      error: TOOL_RESULT_UNAVAILABLE_ERROR,
    })
  })

  it('does not project transformed values', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value', { propagated: true })
    const encoded = Buffer.from('secret-value').toString('base64')

    expect(
      projectToolResultForCopilot({ success: true, output: { result: encoded } }, registry)
    ).toEqual({ success: true, output: { result: encoded } })
  })

  it('projects exact typed numeric secrets, leaving booleans and null identifying nothing', () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'NUMBER', plaintext: '12345678', encryptedValue: 'number-ciphertext' },
      { name: 'BOOLEAN', plaintext: 'true', encryptedValue: 'boolean-ciphertext' },
      { name: 'NULL', plaintext: 'null', encryptedValue: 'null-ciphertext' },
    ])
    registry.recordResolved('NUMBER', '12345678', { propagated: true })
    registry.recordResolved('BOOLEAN', 'true', { propagated: true })
    registry.recordResolved('NULL', 'null', { propagated: true })

    expect(
      projectToolResultForCopilot(
        {
          success: true,
          output: {
            number: 12345678,
            boolean: true,
            nothing: null,
            numberText: '12345678',
            booleanText: 'true',
            nilText: 'null',
          },
        },
        registry
      )
    ).toEqual({
      success: true,
      output: {
        number: '{{NUMBER}}',
        boolean: true,
        nothing: null,
        numberText: '{{NUMBER}}',
        booleanText: 'true',
        nilText: 'null',
      },
    })
  })

  it('preserves configured values until the resolver records them as active', () => {
    const registry = createRegistry()
    const result = {
      success: true,
      output: { result: 'secret-value', stdout: '' },
    }

    expect(projectToolResultForCopilot(result, registry)).toEqual({
      success: true,
      output: { result: 'secret-value', stdout: '' },
    })
  })

  it('serializes table-style dates for Copilot without mutating the runtime result', () => {
    const registry = new ResolvedSecretTraceRegistry()
    const createdAt = new Date('2026-08-05T12:34:56.789Z')
    const runtimeResult = {
      success: true,
      output: {
        table: { id: 'table-1', createdAt },
        rows: [{ id: 'row-1', createdAt }],
      },
    }

    expect(projectToolResultForCopilot(runtimeResult, registry)).toEqual({
      success: true,
      output: {
        table: { id: 'table-1', createdAt: '2026-08-05T12:34:56.789Z' },
        rows: [{ id: 'row-1', createdAt: '2026-08-05T12:34:56.789Z' }],
      },
    })
    expect(runtimeResult.output.table.createdAt).toBe(createdAt)
    expect(runtimeResult.output.rows[0].createdAt).toBe(createdAt)
  })

  it('preserves foreign internal-looking tool output when the registry has no matching alias', () => {
    const registry = new ResolvedSecretTraceRegistry()

    expect(
      projectToolResultForCopilot(
        {
          success: true,
          output: {
            legacy: '__var_FOREIGN_KEY',
            binding: '__sim_code_12_binding_3',
            marker: '__sim_code_12_binding_3_marker_a__',
            runtime: '__sim_runtime_payload_4',
            opaquePlaceholder: '{{[REDACTED_SECRET]}}',
          },
        },
        registry
      )
    ).toEqual({
      success: true,
      output: {
        legacy: '__var_FOREIGN_KEY',
        binding: '__sim_code_12_binding_3',
        marker: '__sim_code_12_binding_3_marker_a__',
        runtime: '__sim_runtime_payload_4',
        opaquePlaceholder: '{{[REDACTED_SECRET]}}',
      },
    })
  })

  it.each([
    ['missing', undefined],
    [
      'incomplete',
      (() => {
        const registry = createRegistry()
        registry.markIncomplete('unspecified')
        return registry
      })(),
    ],
  ])('fails closed for %s provenance without changing structural fields', (_label, registry) => {
    expect(
      projectToolResultForCopilot(
        {
          success: false,
          output: { result: 'possibly-secret' },
          error: 'possibly-secret-error',
          resources: [{ type: 'file', id: 'file-1', title: 'report.txt' }],
        },
        registry
      )
    ).toEqual({ success: false, error: TOOL_RESULT_UNAVAILABLE_ERROR })
  })

  it('leaves resource metadata outside plaintext result projection', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value', { propagated: true })
    const result = {
      success: true,
      resources: [
        {
          type: 'file' as const,
          id: 'file-1',
          title: 'secret-value.txt',
          path: '/workspace/report.txt',
        },
      ],
    }

    expect(projectToolResultForCopilot(result, registry)).toEqual({
      success: true,
      resources: [
        {
          type: 'file',
          id: 'file-1',
          title: 'secret-value.txt',
          path: '/workspace/report.txt',
        },
      ],
    })
    expect(result.resources[0]).toEqual({
      type: 'file',
      id: 'file-1',
      title: 'secret-value.txt',
      path: '/workspace/report.txt',
    })
  })

  it.each([
    { type: 'file' as const, id: 'file-secret-value', title: 'report.txt' },
    {
      type: 'file' as const,
      id: 'file-1',
      title: 'report.txt',
      path: '/workspace/secret-value/report.txt',
    },
  ])('leaves resource routing controls outside plaintext result projection', (resource) => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value', { propagated: true })
    const projected = projectToolResultForCopilot(
      {
        success: true,
        output: {},
        resources: [resource],
      },
      registry
    )

    expect(projected).toEqual({ success: true, output: {}, resources: [resource] })
  })

  it('does not project a tool result from merely active input provenance', () => {
    const registry = createRegistry()
    registry.recordResolved('SECRET', 'secret-value')
    const result = { success: true, output: 'secret-value' }

    expect(projectToolResultForCopilot(result, registry)).toEqual({
      success: true,
      output: 'secret-value',
    })
    expect(result).toEqual({ success: true, output: 'secret-value' })
  })

  it('preserves successful settlement when no trusted result payload is available', () => {
    expect(
      projectToolResultForCopilot({ success: true, output: 'possibly-secret' }, undefined)
    ).toEqual({ success: true })
  })

  it.each(['read', 'glob', 'grep'])(
    'withholds a read-only %s failure without the mutation-retry warning',
    (toolId) => {
      const projected = projectToolResultForCopilot(
        { success: false, error: 'anything' },
        undefined,
        toolId
      )
      expect(projected).toEqual({ success: false, error: READ_TOOL_RESULT_UNAVAILABLE_ERROR })
      expect(projected.error).not.toContain('mutation')
    }
  )

  it('keeps the mutation-retry warning for withheld mutating-tool failures', () => {
    expect(
      projectToolResultForCopilot(
        { success: false, error: 'anything' },
        undefined,
        'apply_file_edit'
      )
    ).toEqual({ success: false, error: TOOL_RESULT_UNAVAILABLE_ERROR })
    expect(toolResultUnavailableError(undefined)).toBe(TOOL_RESULT_UNAVAILABLE_ERROR)
  })
})

describe('effect disclosure on a withheld result', () => {
  const EXECUTION_ID = '0f4d5a4c-6a1e-4c2f-9b7d-2c8f1a3e5d90'

  it('carries nothing extra for a tool that declared no effect', () => {
    expect(projectToolResultForCopilot({ success: true, output: { a: 1 } }, undefined)).toEqual({
      success: true,
    })
    expect(projectToolResultForCopilot({ success: false, error: 'why' }, undefined)).toEqual({
      success: false,
      error: TOOL_RESULT_UNAVAILABLE_ERROR,
    })
  })

  /**
   * The exemption is what makes the disclosure trustworthy, so it has to be all or
   * nothing: a disclosure that silently dropped the id it could not vouch for would
   * read exactly like one that never had a run to name.
   */
  it('voids the whole disclosure when an id is not a shape this system mints', () => {
    expect(
      projectToolResultForCopilot(
        {
          success: false,
          error: 'why',
          effect: { phase: 'performed', ids: { executionId: 'not-a-server-minted-id' } },
        },
        undefined,
        'run_workflow'
      )
    ).toEqual({ success: false, error: TOOL_RESULT_UNAVAILABLE_ERROR })
  })

  it.each(['effect', 'resultWithheld'])(
    'voids the disclosure when an id would take the reserved key %s',
    (reserved) => {
      expect(
        projectToolResultForCopilot(
          {
            success: false,
            error: 'why',
            effect: { phase: 'performed', ids: { [reserved]: EXECUTION_ID } },
          },
          undefined,
          'run_workflow'
        )
      ).toEqual({ success: false, error: TOOL_RESULT_UNAVAILABLE_ERROR })
    }
  )

  it('reports the phase and ids when every id is vouchable', () => {
    expect(
      projectToolResultForCopilot(
        {
          success: false,
          error: 'why',
          effect: { phase: 'attempted', ids: { executionId: EXECUTION_ID } },
        },
        undefined,
        'run_workflow'
      )
    ).toEqual({
      success: false,
      output: { resultWithheld: true, effect: 'attempted', executionId: EXECUTION_ID },
      error: expect.stringContaining('At most one run exists'),
    })
  })

  it('never leaks the disclosure into a result that projected cleanly', () => {
    const registry = new ResolvedSecretTraceRegistry()

    expect(
      projectToolResultForCopilot(
        {
          success: true,
          output: { executionId: EXECUTION_ID },
          effect: { phase: 'performed', ids: { executionId: EXECUTION_ID } },
        },
        registry,
        'run_workflow'
      )
    ).toEqual({ success: true, output: { executionId: EXECUTION_ID } })
  })

  it('names why the content was withheld, for the surface about to log it', () => {
    const latched = createRegistry()
    latched.markIncomplete('source-provenance-incomplete', { origin: 'test.origin' })

    const projection = inspectToolResultForCopilot({ success: false }, latched, 'run_workflow')
    expect(projection.safe).toBe(false)
    // The per-call fork adds its own propagation reason; the guard that originally
    // tripped has to survive alongside it, or a refusal names only the messenger.
    expect(projection.safe === false && describeWithholdingCause(projection.cause)).toEqual({
      withheldCause: 'registry-incomplete',
      withheldReasons: expect.arrayContaining(['source-provenance-incomplete']),
      withheldOrigins: ['test.origin'],
    })

    const absent = inspectToolResultForCopilot({ success: false }, undefined)
    expect(absent.safe === false && absent.cause).toEqual({ kind: 'registry-absent' })
  })
})
