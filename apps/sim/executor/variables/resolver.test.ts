/**
 * @vitest-environment node
 */
import { loggerMock } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compileCodePlaceholders } from '@/lib/execution/code-placeholders'
import { CodeLanguage } from '@/lib/execution/languages'
import { projectResolvedModelInput } from '@/lib/execution/model-input-provenance'
import {
  LARGE_ARRAY_MANIFEST_VERSION,
  type LargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest-metadata'
import { BlockType } from '@/executor/constants'
import { ExecutionState } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { VariableResolver } from '@/executor/variables/resolver'
import { navigatePathAsync } from '@/executor/variables/resolvers/reference-async.server'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const mockVariableResolverLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi.mocked(loggerMock.createLogger).mock.calls.findIndex(([name]) => name === 'VariableResolver')
].value

const { mockStoreLargeValue } = vi.hoisted(() => ({ mockStoreLargeValue: vi.fn() }))

vi.mock('@/lib/execution/payloads/store', () => ({
  storeLargeValue: mockStoreLargeValue,
  materializeLargeValueRef: vi.fn(),
}))

vi.mock('@/lib/core/security/encryption', () => ({
  decryptSecret: vi.fn(async (encryptedValue: string) => ({ decrypted: encryptedValue })),
}))

function createBlock(id: string, name: string, type: string, params = {}): SerializedBlock {
  return {
    id,
    metadata: { id: type, name },
    position: { x: 0, y: 0 },
    config: { tool: type, params },
    inputs: {},
    outputs: {
      result: 'string',
      items: 'json',
      file: 'file',
    },
    enabled: true,
  }
}

function createTestManifest(totalCount = 100_000): LargeArrayManifest {
  return {
    __simLargeArrayManifest: true,
    version: LARGE_ARRAY_MANIFEST_VERSION,
    kind: 'array',
    totalCount,
    chunkCount: 1,
    byteSize: 12 * 1024 * 1024,
    chunks: [
      {
        count: totalCount,
        byteSize: 12 * 1024 * 1024,
        ref: {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'array',
          size: 12 * 1024 * 1024,
          key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json',
          executionId: 'execution-1',
        },
      },
    ],
    preview: [{ key: 'SIM-0' }],
  }
}

function createResolver(
  language = 'javascript',
  options: ConstructorParameters<typeof VariableResolver>[3] = {}
) {
  const producer = createBlock('producer', 'Producer', BlockType.API)
  const functionBlock = createBlock('function', 'Function', BlockType.FUNCTION, {
    language,
  })
  const workflow: SerializedWorkflow = {
    version: '1',
    blocks: [producer, functionBlock],
    connections: [],
    loops: {},
    parallels: {},
  }
  const state = new ExecutionState()
  state.setBlockOutput('producer', {
    result: 'hello world',
    items: ['a', 'b'],
    file: {
      id: 'file-1',
      name: 'image.png',
      url: 'https://example.com/image.png',
      key: 'execution/workspace-1/workflow-1/execution-1/image.png',
      context: 'execution',
      size: 12 * 1024 * 1024,
      type: 'image/png',
      base64: 'large-inline-base64',
    },
  })
  const ctx = {
    blockStates: state.getBlockStates(),
    blockLogs: [],
    environmentVariables: {},
    workflowVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopExecutions: new Map(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(),
    completedLoops: new Set(),
    metadata: {},
  } as ExecutionContext

  return {
    block: functionBlock,
    ctx,
    state,
    resolver: new VariableResolver(workflow, {}, state, options),
  }
}

/** Runs one condition expression through the resolver and returns the value the handler receives. */
async function resolveConditionExpression(
  value: string,
  environmentVariables: Record<string, string>
): Promise<string> {
  const { ctx, resolver } = createResolver()
  ctx.environmentVariables = environmentVariables
  const conditionBlock = createBlock('condition', 'Condition', BlockType.CONDITION)
  const result = await resolver.resolveInputs(
    ctx,
    conditionBlock.id,
    { conditions: JSON.stringify([{ id: 'condition-1', title: 'if', value }]) },
    conditionBlock
  )
  return (result.conditions as Array<{ value: string }>)[0].value
}

/** Resolves one condition expression against a producer output an attacker supplied. */
async function resolveConditionWithBlockOutput(value: string, result: unknown): Promise<string> {
  const { ctx, resolver, state } = createResolver()
  state.setBlockOutput('producer', { result } as never)
  const conditionBlock = createBlock('condition', 'Condition', BlockType.CONDITION)
  const resolved = await resolver.resolveInputs(
    ctx,
    conditionBlock.id,
    { conditions: JSON.stringify([{ id: 'condition-1', title: 'if', value }]) },
    conditionBlock
  )
  return (resolved.conditions as Array<{ value: string }>)[0].value
}

const INJECTION_CANARY = '__conditionInjectionCanary'

/**
 * Evaluates a resolved expression inside the same `Boolean(...)` wrapper the handler builds,
 * reporting both the branch verdict and whether anything the resolved data carried executed.
 */
function runResolvedCondition(expression: string): { matched: boolean; injected: boolean } {
  Reflect.set(globalThis, INJECTION_CANARY, 'not-executed')
  try {
    const matched = Boolean(
      new Function(`const context = {};\nreturn Boolean(\n${expression}\n)`)()
    )
    return { matched, injected: Reflect.get(globalThis, INJECTION_CANARY) !== 'not-executed' }
  } catch {
    return {
      matched: false,
      injected: Reflect.get(globalThis, INJECTION_CANARY) !== 'not-executed',
    }
  } finally {
    Reflect.deleteProperty(globalThis, INJECTION_CANARY)
  }
}

/**
 * Completes the round trip a condition actually takes: resolver, then the execution-boundary
 * compiler, then evaluation of the same `Boolean(...)` wrapper `condition-handler.ts` builds.
 */
async function evaluateResolvedCondition(
  value: string,
  environmentVariables: Record<string, string>
): Promise<boolean> {
  const expression = await resolveConditionExpression(value, environmentVariables)
  const compiled = await compileCodePlaceholders({
    code: `const context = {};\nreturn Boolean(${expression})`,
    language: CodeLanguage.JavaScript,
    environmentVariables,
  })
  const installed: string[] = []
  try {
    for (const binding of compiled.bindings) {
      Object.defineProperty(globalThis, binding.name, {
        configurable: true,
        value: binding.value,
        writable: true,
      })
      installed.push(binding.name)
    }
    return Boolean(new Function(compiled.code)())
  } finally {
    for (const name of installed) Reflect.deleteProperty(globalThis, name)
  }
}

describe('VariableResolver function block inputs', () => {
  it('inlines only structurally inert condition literals and defers the rest to the compiler', async () => {
    const { ctx, resolver } = createResolver()
    ctx.environmentVariables = {
      API_KEY: 'token',
      BOOLEAN_VALUE: 'true',
      NUMBER_VALUE: '123',
    }
    const conditionBlock = createBlock('condition', 'Condition', BlockType.CONDITION)
    const conditions = [
      { id: 'condition-1', title: 'if', value: '{{NUMBER_VALUE}} === 123' },
      { id: 'condition-2', title: 'else if', value: '{{BOOLEAN_VALUE}} === true' },
      { id: 'condition-3', title: 'else if', value: '"Bearer {{API_KEY}}" === "Bearer token"' },
    ]

    const result = await resolver.resolveInputs(
      ctx,
      conditionBlock.id,
      {
        conditions: JSON.stringify(conditions),
      },
      conditionBlock
    )

    expect(result.conditions).toEqual([
      { id: 'condition-1', title: 'if', value: '123 === 123', _readsEnvironmentVariables: false },
      {
        id: 'condition-2',
        title: 'else if',
        value: 'true === true',
        _readsEnvironmentVariables: false,
      },
      {
        id: 'condition-3',
        title: 'else if',
        value: '"Bearer {{API_KEY}}" === "Bearer token"',
        _readsEnvironmentVariables: false,
      },
    ])
  })

  it('records whether the author, not the trigger data, reads the environment map', async () => {
    const { ctx, resolver } = createResolver()
    ctx.environmentVariables = {}
    const conditionBlock = createBlock('condition', 'Condition', BlockType.CONDITION)
    // The second branch only quotes a producer output that happens to contain the word.
    const conditions = [
      { id: 'c1', title: 'if', value: `environmentVariables.FLAG === 'on'` },
      { id: 'c2', title: 'else if', value: `"<producer.result>" === 'x'` },
    ]
    ;(ctx.blockStates as Map<string, any>).set('producer', {
      output: { result: 'environmentVariables.OPENAI_API_KEY' },
      executed: true,
      executionTime: 0,
    })

    const result = await resolver.resolveInputs(
      ctx,
      conditionBlock.id,
      { conditions: JSON.stringify(conditions) },
      conditionBlock
    )

    const resolvedConditions = result.conditions as Array<Record<string, unknown>>
    expect(resolvedConditions[0]._readsEnvironmentVariables).toBe(true)
    expect(resolvedConditions[1]._readsEnvironmentVariables).toBe(false)
    expect(resolvedConditions[1].value).toContain('environmentVariables.OPENAI_API_KEY')
  })

  it('counts an environment read only where it can execute', async () => {
    const { ctx, resolver } = createResolver()
    const conditionBlock = createBlock('condition', 'Condition', BlockType.CONDITION)
    const conditions = [
      // Reads, in the shapes a pattern would have to anticipate.
      { id: 'c1', title: 'if', value: `environmentVariables?.FLAG === 'on'` },
      { id: 'c2', title: 'else if', value: 'Object.keys(environmentVariables).length > 0' },
      // Mentions: text, not code.
      { id: 'c3', title: 'else if', value: `'environmentVariables.FLAG' === 'x'` },
      { id: 'c4', title: 'else if', value: '`environmentVariables` === "x"' },
      { id: 'c5', title: 'else if', value: `/environmentVariables/.test('x')` },
    ]

    const result = await resolver.resolveInputs(
      ctx,
      conditionBlock.id,
      { conditions: JSON.stringify(conditions) },
      conditionBlock
    )

    expect(
      (result.conditions as Array<Record<string, unknown>>).map(
        (condition) => condition._readsEnvironmentVariables
      )
    ).toEqual([true, true, false, false, false])
  })

  it('preserves legacy condition outcomes end to end through the boundary compiler', async () => {
    const environmentVariables = {
      API_KEY: 'token',
      BOOLEAN_VALUE: 'true',
      NUMBER_VALUE: '123',
      NULL_VALUE: 'null',
      NEGATIVE: '-5',
      EXPONENT: '1e3',
    }
    const cases = [
      { value: '{{NUMBER_VALUE}} === 123', expected: true },
      { value: '{{BOOLEAN_VALUE}} === true', expected: true },
      { value: '"Bearer {{API_KEY}}" === "Bearer token"', expected: true },
      { value: `'{{API_KEY}}' === 'token'`, expected: true },
      { value: '{{NULL_VALUE}} === null', expected: true },
      { value: '{{NEGATIVE}} === -5', expected: true },
      { value: '{{EXPONENT}} === 1000', expected: true },
      { value: '{{NUMBER_VALUE}} === 999', expected: false },
    ]

    /** A padded value must stay byte-identical: numeric bare, exact string when quoted. */
    expect(await evaluateResolvedCondition('{{PADDED}} === 123', { PADDED: ' 123 ' })).toBe(true)
    expect(await evaluateResolvedCondition(`'{{PADDED}}' === ' 123 '`, { PADDED: ' 123 ' })).toBe(
      true
    )

    for (const { value, expected } of cases) {
      expect(
        await evaluateResolvedCondition(value, environmentVariables),
        `condition ${value} should evaluate to ${expected}`
      ).toBe(expected)
    }
  })

  it('stops a secret value from breaking or forging a condition', async () => {
    await expect(
      evaluateResolvedCondition(`'{{NAME}}' === 'bob'`, { NAME: `x' || true || '` })
    ).resolves.toBe(false)
    await expect(
      evaluateResolvedCondition(`'{{NAME}}' === "O'Brien"`, { NAME: "O'Brien" })
    ).resolves.toBe(true)
    await expect(
      evaluateResolvedCondition(`'{{NAME}}' === 'a\\nb'`, { NAME: 'a\nb' })
    ).resolves.toBe(true)
  })

  it('stops trigger data from breaking out of a quoted condition reference', async () => {
    // Every quoting an author can put around a reference. The author picks the context;
    // the resolved value must be data in all of them, not just the one it wraps itself in.
    const quotings = [
      `"<producer.result>".includes('urgent')`,
      '"<producer.result>" === "admin"',
      '`<producer.result>`.length > 0',
      '/<producer.result>/.test("x")',
      `<producer.result> === 'admin'`,
    ]
    const payloads = [
      `" + (globalThis.${INJECTION_CANARY} = "ran") + "`,
      `\${(globalThis.${INJECTION_CANARY} = "ran")}`,
      `' + (globalThis.${INJECTION_CANARY} = "ran") + '`,
      `/ + (globalThis.${INJECTION_CANARY} = "ran") + /`,
    ]

    for (const value of quotings) {
      for (const payload of payloads) {
        const expression = await resolveConditionWithBlockOutput(value, payload)
        expect(
          runResolvedCondition(expression).injected,
          `condition ${value} executed trigger data: ${expression}`
        ).toBe(false)
      }
    }
  })

  it('stops a trigger-supplied object from closing the string it is quoted inside', async () => {
    // JSON's own structural quotes close the author's string, and the key is the attacker's.
    const expression = await resolveConditionWithBlockOutput('"<producer.result>" === "{}"', {
      [`+(globalThis.${INJECTION_CANARY}=1)+`]: 1,
    })
    expect(runResolvedCondition(expression).injected).toBe(false)
  })

  it('stops a trigger-supplied object from escaping wherever the quote scanner mis-reads', async () => {
    // A regex literal is not tracked by the quote scanner, and a quote inside one
    // desynchronizes it for everything that follows, so the emitted object must be inert
    // whichever context the scanner reports.
    const payloads = [
      { [`+(globalThis.${INJECTION_CANARY}=1)+`]: 1 },
      { forged: `/ + (globalThis.${INJECTION_CANARY}=1) + /` },
      { closed: `" + (globalThis.${INJECTION_CANARY}=1) + "` },
    ]
    const quotings = [
      '/<producer.result>/.test("x")',
      `/['"]/.test('a') && <producer.result>.count === 2`,
      `/['"]/.test('a') && "<producer.result>" === "{}"`,
      '<producer.result>.count === 2',
    ]

    for (const value of quotings) {
      for (const payload of payloads) {
        const expression = await resolveConditionWithBlockOutput(value, payload)
        expect(
          runResolvedCondition(expression).injected,
          `condition ${value} executed object data: ${expression}`
        ).toBe(false)
      }
    }
  })

  it('keeps navigating an object reference the scanner reports as unquoted', async () => {
    const expression = await resolveConditionWithBlockOutput('<producer.result>.count === 2', {
      count: 2,
      note: `a "quoted" / slashed ' value`,
    })
    expect(runResolvedCondition(expression).matched).toBe(true)
  })

  it('evaluates references that follow a regex literal, quote-bearing or not', async () => {
    // A regex body is the one place a lone quote is not a string delimiter. Reading it as one
    // left every later reference formatted for a context it was not in — a quoted object
    // reference stayed raw source, and a bare one was emitted as escaped JSON that cannot parse.
    const cases: Array<{ value: string; result: unknown; expected: boolean }> = [
      // Every case reaches its reference — a short-circuit would pass on a formatter that
      // emits source the sandbox cannot parse, which is the failure being pinned here.
      {
        value: `/['"a]/.test('a') && <producer.result>.count === 2`,
        result: { count: 2 },
        expected: true,
      },
      { value: `/['"]/.test('a') || <producer.result> === 'x'`, result: 'x', expected: true },
      {
        value: `/it's/.test('a') || "<producer.result>".includes('b')`,
        result: 'abc',
        expected: true,
      },
      {
        value: `/[a-z]/.test('a') && <producer.result>.count === 2`,
        result: { count: 2 },
        expected: true,
      },
      // Division, not a regex: the scan must not swallow the rest of the expression.
      { value: `<producer.result>.total / 2 === 5`, result: { total: 10 }, expected: true },
      {
        value: `(<producer.result>.total / 2) === 5 && '<producer.result>'.length > 0`,
        result: { total: 10 },
        expected: true,
      },
    ]

    for (const { value, result, expected } of cases) {
      const expression = await resolveConditionWithBlockOutput(value, result)
      const verdict = runResolvedCondition(expression)
      expect(verdict.injected, `condition ${value} executed data: ${expression}`).toBe(false)
      expect(verdict.matched, `condition ${value} resolved to: ${expression}`).toBe(expected)
    }
  })

  it('keeps quoted and bare condition references comparing what they compared before', async () => {
    const cases: Array<{ value: string; result: unknown; expected: boolean }> = [
      { value: `<producer.result> === 'urgent'`, result: 'urgent', expected: true },
      { value: `<producer.result> === 'urgent'`, result: 'other', expected: false },
      { value: `"<producer.result>".includes('urgent')`, result: 'urgent ticket', expected: true },
      { value: `"<producer.result>".includes('urgent')`, result: 'calm ticket', expected: false },
      { value: '`<producer.result>`.length > 3', result: 'hello', expected: true },
      { value: `<producer.result> === 'a"b'`, result: 'a"b', expected: true },
      { value: '<producer.result> === `a$b/c`', result: 'a$b/c', expected: true },
      { value: `<producer.result>.count === 2`, result: { count: 2 }, expected: true },
    ]

    for (const { value, result, expected } of cases) {
      const expression = await resolveConditionWithBlockOutput(value, result)
      expect(runResolvedCondition(expression).matched, `condition ${value}`).toBe(expected)
    }
  })

  it('compares a bare string placeholder instead of throwing a reference error', async () => {
    await expect(
      evaluateResolvedCondition(`{{NAME}} === 'alice'`, { NAME: 'alice' })
    ).resolves.toBe(true)
    await expect(evaluateResolvedCondition(`{{NAME}} === 'alice'`, { NAME: 'bob' })).resolves.toBe(
      false
    )
  })

  it('keeps a resolved secret out of the code sent to the execution boundary', async () => {
    const resolved = await resolveConditionExpression(`'{{API_KEY}}' === 'token'`, {
      API_KEY: 'token',
    })
    expect(resolved).toBe(`'{{API_KEY}}' === 'token'`)
  })

  it('does not log malformed Condition source while falling back to legacy resolution', async () => {
    const { ctx, resolver } = createResolver()
    const secret = 'condition-fallback-secret-value'
    const conditionBlock = createBlock('condition', 'Condition', BlockType.CONDITION)

    const result = await resolver.resolveInputs(
      ctx,
      conditionBlock.id,
      { conditions: `{ "value": "${secret}"` },
      conditionBlock
    )

    expect(result.conditions).toContain(secret)
    expect(JSON.stringify(mockVariableResolverLogger.warn.mock.calls)).not.toContain(secret)
  })

  it('records a secret reached through workflow-variable indirection', async () => {
    const { ctx, resolver } = createResolver()
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'resolved-secret', encryptedValue: 'ciphertext' },
    ])
    ctx.workflowVariables = {
      'var-1': { id: 'var-1', name: 'indirect', type: 'string', value: '{{TOKEN}}' },
    }
    ctx.environmentVariables = { TOKEN: 'resolved-secret' }
    ctx.resolvedSecretTraceRegistry = registry

    const result = await resolver.resolveInputs(ctx, 'function', {
      value: '<variable.indirect>',
    })

    expect(result.value).toBe('resolved-secret')
    expect(registry.getActiveMatches()).toEqual([
      { plaintext: 'resolved-secret', replacement: '{{TOKEN}}' },
    ])
  })

  it('binds propagated references to exact model-selected inputs without changing runtime values', async () => {
    const secret = 'xxxxxxxx'
    const provenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: secret }],
    }
    const producer = createBlock('producer', 'Producer', BlockType.API)
    const loop = createBlock('loop-1', 'Loop1', BlockType.LOOP)
    const parallel = createBlock('parallel-1', 'Parallel1', BlockType.PARALLEL)
    const consumer = createBlock('consumer', 'Consumer', BlockType.API)
    const workflowVariables = {
      'var-1': { id: 'var-1', name: 'token', type: 'string', value: secret },
    }
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [producer, loop, parallel, consumer],
      connections: [],
      loops: {
        'loop-1': { id: 'loop-1', nodes: [], iterations: 1, loopType: 'for' },
      },
      parallels: {
        'parallel-1': {
          id: 'parallel-1',
          nodes: [],
          parallelType: 'count',
          count: 1,
        },
      },
    }
    const state = new ExecutionState()
    state.setBlockOutput('producer', { result: secret }, 0, provenance)
    state.setBlockOutput('loop-1', { results: [secret] }, 0, provenance)
    state.setBlockOutput('parallel-1', { results: [secret] }, 0, provenance)
    const registry = new ResolvedSecretTraceRegistry()
    const ctx = {
      blockStates: state.getBlockStates(),
      blockLogs: [],
      environmentVariables: {},
      workflowVariables,
      workflowVariableResolvedSecretTraceProvenance: { 'var-1': provenance },
      resolvedSecretTraceRegistry: registry,
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      parallelExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
      metadata: {},
    } as ExecutionContext
    const resolver = new VariableResolver(workflow, workflowVariables, state, {
      navigatePathAsync,
    })
    const inputs = {
      blockPrompt: 'Box: <Producer.result>',
      workflowPrompt: 'Workflow: <variable.token>',
      loopPrompt: 'Loop: <Loop1.results[0]>',
      parallelPrompt: 'Parallel: <Parallel1.results[0]>',
    }

    const resolved = await resolver.resolveInputs(ctx, consumer.id, inputs, consumer)

    expect(resolved).toEqual({
      blockPrompt: `Box: ${secret}`,
      workflowPrompt: `Workflow: ${secret}`,
      loopPrompt: `Loop: ${secret}`,
      parallelPrompt: `Parallel: ${secret}`,
    })
    const projection = projectResolvedModelInput(
      registry,
      resolved,
      Object.keys(inputs).map((key) => [key])
    )
    expect(projection.complete).toBe(true)
    if (!projection.complete) throw new Error('Expected complete model projection')
    expect(projection.value).toEqual(inputs)
  })

  it('preserves the destination path when resolving one whole reference directly', async () => {
    const secret = 'resolved-secret'
    const provenance = {
      version: 1 as const,
      complete: true,
      entries: [{ name: 'TOKEN', encryptedValue: secret }],
    }
    const { ctx, resolver, state } = createResolver()
    state.setBlockOutput('producer', { result: secret }, 0, provenance)
    ctx.blockStates = state.getBlockStates()
    const registry = new ResolvedSecretTraceRegistry()
    ctx.resolvedSecretTraceRegistry = registry

    await expect(
      resolver.resolveSingleReference(ctx, 'function', '<Producer.result>', undefined, {
        inputPath: ['prompt'],
      })
    ).resolves.toBe(secret)
    expect(registry.exportCommittedProvenanceForInputPaths([['prompt']])).toEqual(provenance)
    expect(registry.projectResolvedInputSelection({ prompt: secret })).toEqual({
      complete: true,
      value: { prompt: '<Producer.result>' },
    })
  })

  it('returns empty inputs when params are missing', async () => {
    const { block, ctx, resolver } = createResolver()

    const result = await resolver.resolveInputsForFunctionBlock(ctx, 'function', undefined, block)

    expect(result).toEqual({ resolvedInputs: {}, displayInputs: {}, contextVariables: {} })
  })

  it('changes only environment placeholders while preserving legacy Function resolution', async () => {
    const { block, ctx, resolver } = createResolver('javascript')
    ctx.environmentVariables = { API_KEY: 'runtime-secret' }
    ctx.workflowVariables = {
      'var-count': { id: 'var-count', name: 'count', type: 'number', value: 7 },
      'var-options': {
        id: 'var-options',
        name: 'options',
        type: 'object',
        value: { enabled: true, retries: 2 },
      },
      'var-indirect-secret': {
        id: 'var-indirect-secret',
        name: 'indirectSecret',
        type: 'string',
        value: '{{API_KEY}}',
      },
    }
    const typedInput = { enabled: true, retries: 3, labels: ['one', 'two'] }

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      {
        code: [
          'const byName = <Producer.items>',
          'const byId = <producer.result>',
          'const count = <variable.count>',
          'const options = <variable.options>',
          'const indirectSecret = <variable.indirectSecret>',
          'const missing = <Missing.result>',
          'const missingVariable = <variable.missing>',
          'const secret = "{{API_KEY}}"',
          'return { byName, byId, count, options, missing, missingVariable, secret }',
        ].join('\n'),
        language: 'javascript',
        timeout: 12_345,
        typedInput,
      },
      block
    )

    expect(result.resolvedInputs.code).toContain('const byName = globalThis["__blockRef_0"]')
    expect(result.resolvedInputs.code).toContain('const byId = globalThis["__blockRef_1"]')
    expect(result.resolvedInputs.code).toContain('const count = 7')
    expect(result.resolvedInputs.code).toContain('const options = globalThis["__blockRef_2"]')
    expect(result.resolvedInputs.code).toContain('const indirectSecret = "{{API_KEY}}"')
    expect(result.resolvedInputs.code).toContain('const missing = <Missing.result>')
    expect(result.resolvedInputs.code).toContain('const missingVariable = <variable.missing>')
    expect(result.resolvedInputs.code).toContain('const secret = "{{API_KEY}}"')
    expect(result.displayInputs.code).toContain('const byName = ["a","b"]')
    expect(result.displayInputs.code).toContain('const byId = "hello world"')
    expect(result.displayInputs.code).toContain('const options = {"enabled":true,"retries":2}')
    expect(result.displayInputs.code).toContain('const indirectSecret = "{{API_KEY}}"')
    expect(result.displayInputs.code).toContain('const missing = <Missing.result>')
    expect(result.displayInputs.code).toContain('const missingVariable = <variable.missing>')
    expect(result.displayInputs.code).toContain('const secret = "{{API_KEY}}"')
    expect(result.contextVariables).toEqual({
      __blockRef_0: ['a', 'b'],
      __blockRef_1: 'hello world',
      __blockRef_2: { enabled: true, retries: 2 },
    })
    expect(result.resolvedInputs.language).toBe('javascript')
    expect(result.resolvedInputs.timeout).toBe(12_345)
    expect(result.resolvedInputs.typedInput).toEqual(typedInput)
    expect(result.displayInputs.typedInput).toEqual(typedInput)
  })

  it.each(['javascript', 'python'])(
    'preserves an exact-name/exact-value secret in %s source until the execution boundary',
    async (language) => {
      const { block, ctx, resolver } = createResolver(language)
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'Test', plaintext: 'Test', encryptedValue: 'ciphertext' },
      ])
      const source = 'return {{Test}}'
      ctx.environmentVariables = { Test: 'Test' }
      ctx.resolvedSecretTraceRegistry = registry

      const result = await resolver.resolveInputsForFunctionBlock(
        ctx,
        'function',
        { code: source },
        block
      )

      expect(result.resolvedInputs.code).toBe(source)
      expect(result.displayInputs.code).toBe(source)
      expect(result.contextVariables).toEqual({})
      expect(registry.getActiveMatches()).toEqual([])
    }
  )

  it('resolves JavaScript block references through globalThis context variables', async () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <Producer.result>' },
      block
    )

    expect(result.resolvedInputs.code).toBe('return globalThis["__blockRef_0"]')
    expect(result.displayInputs.code).toBe('return "hello world"')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('allows Variables block assignments to receive whole large refs', async () => {
    const producer = createBlock('producer', 'Producer', BlockType.API)
    const variablesBlock = createBlock('variables', 'Variables', BlockType.VARIABLES, {
      variables: [
        {
          variableId: 'var-1',
          variableName: 'issues',
          type: 'array',
          value: '<Producer.result>',
        },
      ],
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [producer, variablesBlock],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEFGHIJKL',
      kind: 'array',
      size: 12 * 1024 * 1024,
      executionId: 'execution-1',
    }
    state.setBlockOutput('producer', { result: ref })
    const ctx = {
      blockStates: state.getBlockStates(),
      blockLogs: [],
      environmentVariables: {},
      workflowVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
      metadata: {},
    } as ExecutionContext

    const resolver = new VariableResolver(workflow, {}, state)
    const result = await resolver.resolveInputs(
      ctx,
      'variables',
      variablesBlock.config.params,
      variablesBlock
    )

    expect(JSON.parse(result.variables[0].value)).toEqual(ref)
  })

  it('allows Variables block assignments to receive whole large array manifests', async () => {
    const producer = createBlock('producer', 'Producer', BlockType.API)
    const variablesBlock = createBlock('variables', 'Variables', BlockType.VARIABLES, {
      variables: [
        {
          variableId: 'var-1',
          variableName: 'issues',
          type: 'array',
          value: '<Producer.result>',
        },
      ],
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [producer, variablesBlock],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const manifest = createTestManifest()
    state.setBlockOutput('producer', { result: manifest })
    const ctx = {
      blockStates: state.getBlockStates(),
      blockLogs: [],
      environmentVariables: {},
      workflowVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
      metadata: {},
    } as ExecutionContext

    const resolver = new VariableResolver(workflow, {}, state)
    const result = await resolver.resolveInputs(
      ctx,
      'variables',
      variablesBlock.config.params,
      variablesBlock
    )

    expect(JSON.parse(result.variables[0].value)).toEqual(manifest)
  })

  it('allows Response block data to preserve whole large refs', async () => {
    const producer = createBlock('producer', 'Producer', BlockType.API)
    const responseBlock = createBlock('response', 'Response', BlockType.RESPONSE, {
      dataMode: 'json',
      data: '<Producer.result>',
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [producer, responseBlock],
      connections: [],
      loops: {},
      parallels: {},
    }
    const state = new ExecutionState()
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ZYXWVUTSRQPO',
      kind: 'array',
      size: 12 * 1024 * 1024,
      executionId: 'execution-1',
    }
    state.setBlockOutput('producer', { result: ref })
    const ctx = {
      blockStates: state.getBlockStates(),
      blockLogs: [],
      environmentVariables: {},
      workflowVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
      metadata: {},
    } as ExecutionContext

    const resolver = new VariableResolver(workflow, {}, state)
    const result = await resolver.resolveInputs(
      ctx,
      'response',
      responseBlock.config.params,
      responseBlock
    )

    expect(JSON.parse(result.data)).toEqual(ref)
  })

  it('resolves workflow variable object references through context variables', async () => {
    const { block, ctx, resolver } = createResolver('javascript')
    const issues = [{ key: 'SIM-1', summary: 'Small issue' }]
    ctx.workflowVariables = {
      'var-1': { id: 'var-1', name: 'issues', type: 'array', value: issues },
    }

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <variable.issues>' },
      block
    )

    expect(result.resolvedInputs.code).toBe('return globalThis["__blockRef_0"]')
    expect(result.displayInputs.code).toBe('return [{"key":"SIM-1","summary":"Small issue"}]')
    expect(result.contextVariables).toEqual({ __blockRef_0: issues })
  })

  it('resolves large workflow variable refs without embedding large literals', async () => {
    const { block, ctx, resolver } = createResolver('javascript')
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEFGHIJKL',
      kind: 'array',
      size: 12 * 1024 * 1024,
      executionId: 'execution-1',
    }
    ctx.workflowVariables = {
      'var-1': { id: 'var-1', name: 'issues', type: 'array', value: ref },
    }

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <variable.issues>' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      'return (await sim.values.read(globalThis["__blockRef_0"]))'
    )
    expect(result.contextVariables).toEqual({ __blockRef_0: ref })
  })

  it('reads the context of a reference that follows a statement-position regex', async () => {
    // `)` ends a value in `(a + b) / 2` and a control-flow head in `if (a) /re/.test(b)`, and
    // the closing parenthesis alone does not say which. Guessing either way misreads one of
    // them, and a quote inside the regex then decides how every later reference is spliced.
    const { block, ctx, resolver } = createResolver('javascript')

    // Both cases stay on one line: a string mode ends at a newline, so only a reference sharing
    // the line with the misread slash sees the wrong context.
    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      {
        code: [
          `if (params.a) /['"]/.test('<producer.result>')`,
          `const divided = (params.c + 1) / 2 + Number('<producer.result>')`,
          'return divided',
        ].join('\n'),
      },
      block
    )

    const code = result.resolvedInputs.code as string
    // Statement-position regex: the reference after it is inside the author's quotes.
    expect(code).toContain(`.test('' + JSON.stringify(globalThis["__blockRef_0"]) + '')`)
    // Division after a value: the slash must not open a regex that swallows the quotes.
    expect(code).toContain(`Number('' + JSON.stringify(globalThis["__blockRef_1"]) + '')`)
  })

  it('steps over a comment rather than reading it as the preceding token', async () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      {
        code: [
          `/* lead */ if (params.a) /['"]/.test('<producer.result>')`,
          `const n = params.p./* mid */catch(() => 0) / 2 + Number('<producer.result>')`,
        ].join('\n'),
      },
      block
    )

    // A comment before a control-flow keyword leaves it a head; one hiding a property dot
    // still leaves the call a call.
    const code = result.resolvedInputs.code as string
    expect(code).toContain(`.test('' + JSON.stringify(globalThis["__blockRef_0"]) + '')`)
    expect(code).toContain(`Number('' + JSON.stringify(globalThis["__blockRef_1"]) + '')`)
  })

  it('does not read a method named after a keyword as a control-flow head', async () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: `const n = params.p.catch(() => 0) / 2 + Number('<producer.result>')` },
      block
    )

    // `.catch(…)` is a call, so the slash after it divides — it must not open a regex that
    // runs over the quotes around the reference.
    expect(result.resolvedInputs.code).toContain(
      `Number('' + JSON.stringify(globalThis["__blockRef_0"]) + '')`
    )
  })

  it('binds a run value that names a secret instead of expanding it', async () => {
    const { block, ctx, resolver } = createResolver('javascript')
    ctx.workflowVariables = {
      'var-1': { id: 'var-1', name: 'authTemplate', type: 'string', value: 'Bearer {{API_KEY}}' },
    }

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: `const header = '<variable.authTemplate>'; const item = <producer.result>` },
      block
    )

    // An author-configured variable keeps its placeholder in source, where the boundary
    // compiler expands it; a run value naming a secret binds instead, so whoever supplies
    // the text cannot pick what the compiler materializes next to it.
    const code = result.resolvedInputs.code as string
    expect(code).toContain('{{API_KEY}}')
    expect(code).toContain('const item = globalThis["__blockRef_0"]')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('binds a workflow variable carrying quote characters instead of splicing it into code', async () => {
    // A Variables block can assign trigger data at runtime, so a variable's value is not
    // necessarily the author's. Inlined as a literal it closed the string it landed in.
    const { block, ctx, resolver } = createResolver('javascript')
    const payload = `' + (globalThis.__functionInjection = 1) + '`
    ctx.workflowVariables = {
      'var-1': { id: 'var-1', name: 'userinput', type: 'string', value: payload },
    }

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: `const x = '<variable.userinput>'; return x` },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      `const x = '' + JSON.stringify(globalThis["__blockRef_0"]) + ''; return x`
    )
    expect(result.contextVariables).toEqual({ __blockRef_0: payload })
  })

  it('rewrites whole manifest workflow variables to lazy JavaScript array reads', async () => {
    const { block, ctx, resolver } = createResolver('javascript')
    const manifest = createTestManifest()
    ctx.workflowVariables = {
      'var-1': { id: 'var-1', name: 'issues', type: 'array', value: manifest },
    }

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <variable.issues>' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      'return (await sim.values.readArray(globalThis["__blockRef_0"]))'
    )
    expect(result.contextVariables).toEqual({ __blockRef_0: manifest })
  })

  it('resolves manifest workflow variable length without whole-array context variables', async () => {
    const { block, ctx, resolver } = createResolver('javascript', { navigatePathAsync })
    const manifest = createTestManifest()
    ctx.workflowVariables = {
      'var-1': { id: 'var-1', name: 'issues', type: 'array', value: manifest },
    }

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <variable.issues.length>' },
      block
    )

    expect(result.resolvedInputs.code).toBe('return 100000')
    expect(result.contextVariables).toEqual({})
  })

  it('keeps manifest internals hidden during async path navigation', async () => {
    const { ctx } = createResolver()
    const manifest = createTestManifest()

    await expect(navigatePathAsync(manifest, ['totalCount'], ctx)).resolves.toBe(100_000)
    await expect(navigatePathAsync(manifest, ['chunkCount'], ctx)).resolves.toBe(1)
    await expect(navigatePathAsync(manifest, ['preview'], ctx)).resolves.toEqual([{ key: 'SIM-0' }])
    await expect(
      navigatePathAsync(manifest, ['chunks', '0', 'ref', 'id'], ctx)
    ).resolves.toBeUndefined()
  })

  it('resolves indexed manifest workflow variable paths without whole-array context variables', async () => {
    const manifest = createTestManifest()
    const navigateManifestPath = vi.fn(async () => 'SIM-0')
    const { block, ctx, resolver } = createResolver('javascript', {
      navigatePathAsync: navigateManifestPath,
    })
    ctx.workflowVariables = {
      'var-1': { id: 'var-1', name: 'issues', type: 'array', value: manifest },
    }

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <variable.issues[0].key>' },
      block
    )

    expect(navigateManifestPath).toHaveBeenCalledWith(
      manifest,
      ['0', 'key'],
      expect.objectContaining({ allowLargeValueRefs: true })
    )
    // The navigated element binds like any other resolved value; what must not appear is
    // the manifest, or the array it stands for.
    expect(result.resolvedInputs.code).toBe('return globalThis["__blockRef_0"]')
    expect(result.displayInputs.code).toBe('return "SIM-0"')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'SIM-0' })
  })

  it('resolves named loop result bracket paths in function code', async () => {
    const loopBlock = createBlock('loop-1', 'Loop 1', 'loop')
    const functionBlock = createBlock('function', 'Function', BlockType.FUNCTION, {
      language: 'javascript',
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [loopBlock, functionBlock],
      connections: [],
      loops: { 'loop-1': { nodes: ['producer'] } },
      parallels: {},
    }
    const state = new ExecutionState()
    state.setBlockOutput('loop-1', {
      results: [[{ id: 'a' }], [{ id: 'b' }]],
    })
    const ctx = {
      blockStates: state.getBlockStates(),
      blockLogs: [],
      environmentVariables: {},
      workflowVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
      metadata: {},
    } as ExecutionContext
    const resolver = new VariableResolver(workflow, {}, state)

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <loop1.results[1][0].id>' },
      functionBlock
    )

    expect(result.resolvedInputs.code).toBe('return globalThis["__blockRef_0"]')
    expect(result.displayInputs.code).toBe('return "b"')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'b' })
  })

  it('rewrites JavaScript file base64 references to lazy runtime reads', async () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'const base64 = <Producer.file.base64>;\nreturn base64' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      'const base64 = (await sim.files.readBase64(globalThis["__blockRef_0"]));\nreturn base64'
    )
    expect(result.displayInputs.code).toBe('const base64 = <Producer.file.base64>;\nreturn base64')
    expect(result.contextVariables.__blockRef_0).toMatchObject({
      id: 'file-1',
      name: 'image.png',
    })
    expect(result.contextVariables.__blockRef_0).not.toHaveProperty('base64')
  })

  it('wraps lazy JavaScript file base64 reads before member access', async () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <Producer.file.base64>.length' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      'return (await sim.files.readBase64(globalThis["__blockRef_0"])).length'
    )
  })

  it('uses existing inline base64 for keyless files instead of lazy storage reads', async () => {
    const { block, ctx, resolver } = createResolver('javascript')
    const state = new ExecutionState()
    state.setBlockOutput('producer', {
      file: {
        id: 'file-keyless',
        name: 'inline.txt',
        key: '',
        url: 'https://example.com/inline.txt',
        size: 5,
        type: 'text/plain',
        base64: 'aGVsbG8=',
      },
    })

    const keylessResolver = new VariableResolver(
      {
        version: '1',
        blocks: [createBlock('producer', 'Producer', BlockType.API), block],
        connections: [],
        loops: {},
        parallels: {},
      },
      {},
      state
    )

    const result = await keylessResolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <Producer.file.base64>' },
      block
    )

    expect(result.resolvedInputs.code).toBe('return globalThis["__blockRef_0"]')
    expect(result.contextVariables.__blockRef_0).toBe('aGVsbG8=')
  })

  it('rewrites loop current item base64 references to lazy runtime reads', async () => {
    const functionBlock = createBlock('function', 'Function', BlockType.FUNCTION, {
      language: 'javascript',
    })
    const loopBlock = createBlock('loop-1', 'Loop 1', 'loop')
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [loopBlock, functionBlock],
      connections: [],
      loops: { 'loop-1': { id: 'loop-1', nodes: ['function'], iterations: 1 } },
      parallels: {},
    }
    const state = new ExecutionState()
    const file = {
      id: 'file-loop',
      name: 'loop.png',
      url: 'https://example.com/loop.png',
      key: 'execution/workspace-1/workflow-1/execution-1/loop.png',
      context: 'execution',
      size: 12 * 1024 * 1024,
      type: 'image/png',
      base64: 'large-inline-base64',
    }
    const ctx = {
      ...createResolver().ctx,
      loopExecutions: new Map([
        [
          'loop-1',
          {
            iteration: 0,
            currentIterationOutputs: new Map(),
            allIterationOutputs: [],
            item: file,
            items: [file],
          },
        ],
      ]),
    } as ExecutionContext
    const resolver = new VariableResolver(workflow, {}, state)

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <loop.currentItem.base64>.length' },
      functionBlock
    )

    expect(result.resolvedInputs.code).toBe(
      'return (await sim.files.readBase64(globalThis["__blockRef_0"])).length'
    )
    expect(result.contextVariables.__blockRef_0).toMatchObject({ id: 'file-loop' })
    expect(result.contextVariables.__blockRef_0).not.toHaveProperty('base64')
  })

  it('rewrites parallel current item base64 references to lazy runtime reads', async () => {
    const functionBlock = createBlock('function', 'Function', BlockType.FUNCTION, {
      language: 'javascript',
    })
    const parallelBlock = createBlock('parallel-1', 'Parallel 1', 'parallel')
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [parallelBlock, functionBlock],
      connections: [],
      loops: {},
      parallels: {
        'parallel-1': {
          id: 'parallel-1',
          nodes: ['function'],
          parallelType: 'collection',
          distribution: [],
        },
      },
    }
    const state = new ExecutionState()
    const file = {
      id: 'file-parallel',
      name: 'parallel.png',
      url: 'https://example.com/parallel.png',
      key: 'execution/workspace-1/workflow-1/execution-1/parallel.png',
      context: 'execution',
      size: 12 * 1024 * 1024,
      type: 'image/png',
      base64: 'large-inline-base64',
    }
    const ctx = {
      ...createResolver().ctx,
      parallelExecutions: new Map([
        [
          'parallel-1',
          {
            parallelId: 'parallel-1',
            totalBranches: 1,
            branchOutputs: new Map(),
            items: [{ file }],
          },
        ],
      ]),
      parallelBlockMapping: new Map([
        ['function', { originalBlockId: 'function', parallelId: 'parallel-1', iterationIndex: 0 }],
      ]),
    } as ExecutionContext
    const resolver = new VariableResolver(workflow, {}, state)

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <parallel.currentItem.file.base64>.length' },
      functionBlock
    )

    expect(result.resolvedInputs.code).toBe(
      'return (await sim.files.readBase64(globalThis["__blockRef_0"])).length'
    )
    expect(result.contextVariables.__blockRef_0).toMatchObject({ id: 'file-parallel' })
    expect(result.contextVariables.__blockRef_0).not.toHaveProperty('base64')
  })

  it('rewrites JavaScript large value refs to lazy runtime reads', async () => {
    const { block, ctx, resolver } = createResolver('javascript')
    const state = new ExecutionState()
    state.setBlockOutput('producer', {
      result: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_ABCDEFGHIJKL',
        kind: 'object',
        size: 12 * 1024 * 1024,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json',
        executionId: 'execution-1',
      },
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [createBlock('producer', 'Producer', BlockType.API), block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const largeResolver = new VariableResolver(workflow, {}, state)
    const largeCtx = {
      ...ctx,
      blockStates: state.getBlockStates(),
    } as ExecutionContext

    const result = await largeResolver.resolveInputsForFunctionBlock(
      largeCtx,
      'function',
      { code: 'return <Producer.result>' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      'return (await sim.values.read(globalThis["__blockRef_0"]))'
    )
    expect(result.contextVariables.__blockRef_0).toMatchObject({
      __simLargeValueRef: true,
      id: 'lv_ABCDEFGHIJKL',
    })
  })

  it('fails whole large value refs for Function runtimes without lazy helpers', async () => {
    const { block, ctx } = createResolver('python')
    const state = new ExecutionState()
    state.setBlockOutput('producer', {
      result: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_ABCDEFGHIJKL',
        kind: 'object',
        size: 12 * 1024 * 1024,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json',
        executionId: 'execution-1',
      },
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [createBlock('producer', 'Producer', BlockType.API), block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const largeResolver = new VariableResolver(workflow, {}, state)
    const largeCtx = {
      ...ctx,
      blockStates: state.getBlockStates(),
    } as ExecutionContext

    await expect(
      largeResolver.resolveInputsForFunctionBlock(
        largeCtx,
        'function',
        { code: 'return <Producer.result>' },
        block
      )
    ).rejects.toThrow('This execution value is too large to inline')
  })

  it('fails whole large array manifests for Function runtimes without lazy helpers', async () => {
    const { block, ctx } = createResolver('python')
    const state = new ExecutionState()
    state.setBlockOutput('producer', {
      result: createTestManifest(),
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [createBlock('producer', 'Producer', BlockType.API), block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const largeResolver = new VariableResolver(workflow, {}, state)
    const largeCtx = {
      ...ctx,
      blockStates: state.getBlockStates(),
    } as ExecutionContext

    await expect(
      largeResolver.resolveInputsForFunctionBlock(
        largeCtx,
        'function',
        { code: 'return <Producer.result>' },
        block
      )
    ).rejects.toThrow('This execution value contains nested large values')
  })

  it('fails whole large value refs for JavaScript with imports', async () => {
    const { block, ctx } = createResolver('javascript')
    const state = new ExecutionState()
    state.setBlockOutput('producer', {
      result: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_ABCDEFGHIJKL',
        kind: 'object',
        size: 12 * 1024 * 1024,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json',
        executionId: 'execution-1',
      },
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [createBlock('producer', 'Producer', BlockType.API), block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const largeResolver = new VariableResolver(workflow, {}, state)
    const largeCtx = {
      ...ctx,
      blockStates: state.getBlockStates(),
    } as ExecutionContext

    await expect(
      largeResolver.resolveInputsForFunctionBlock(
        largeCtx,
        'function',
        { code: "import x from 'x'\nreturn <Producer.result>" },
        block
      )
    ).rejects.toThrow('This execution value is too large to inline')
  })

  it('keeps JavaScript lazy helpers enabled when import appears in comments or strings', async () => {
    const { block, ctx } = createResolver('javascript')
    const state = new ExecutionState()
    state.setBlockOutput('producer', {
      result: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_ABCDEFGHIJKL',
        kind: 'object',
        size: 12 * 1024 * 1024,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json',
        executionId: 'execution-1',
      },
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [createBlock('producer', 'Producer', BlockType.API), block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const largeResolver = new VariableResolver(workflow, {}, state)
    const largeCtx = {
      ...ctx,
      blockStates: state.getBlockStates(),
    } as ExecutionContext

    const result = await largeResolver.resolveInputsForFunctionBlock(
      largeCtx,
      'function',
      {
        code: "/** @import { Foo } from 'foo' */\nconst text = \"import bar from 'bar'\"\nreturn <Producer.result>",
      },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      '/** @import { Foo } from \'foo\' */\nconst text = "import bar from \'bar\'"\nreturn (await sim.values.read(globalThis["__blockRef_0"]))'
    )
  })

  it('keeps JavaScript lazy helpers enabled for dynamic import expressions', async () => {
    const { block, ctx } = createResolver('javascript')
    const state = new ExecutionState()
    state.setBlockOutput('producer', {
      result: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_ABCDEFGHIJKL',
        kind: 'object',
        size: 12 * 1024 * 1024,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json',
        executionId: 'execution-1',
      },
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [createBlock('producer', 'Producer', BlockType.API), block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const largeResolver = new VariableResolver(workflow, {}, state)
    const largeCtx = {
      ...ctx,
      blockStates: state.getBlockStates(),
    } as ExecutionContext

    const result = await largeResolver.resolveInputsForFunctionBlock(
      largeCtx,
      'function',
      { code: "const mod = import('foo')\nreturn <Producer.result>" },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      'const mod = import(\'foo\')\nreturn (await sim.values.read(globalThis["__blockRef_0"]))'
    )
  })

  it('fails nested large value refs for Function runtimes without lazy helpers', async () => {
    const { block, ctx } = createResolver('python')
    const state = new ExecutionState()
    state.setBlockOutput('producer', {
      result: {
        rows: {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'array',
          size: 12 * 1024 * 1024,
          key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json',
          executionId: 'execution-1',
        },
      },
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [createBlock('producer', 'Producer', BlockType.API), block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const largeResolver = new VariableResolver(workflow, {}, state)
    const largeCtx = {
      ...ctx,
      blockStates: state.getBlockStates(),
    } as ExecutionContext

    await expect(
      largeResolver.resolveInputsForFunctionBlock(
        largeCtx,
        'function',
        { code: 'return <Producer.result>' },
        block
      )
    ).rejects.toThrow('This execution value contains nested large values')
  })

  it('fails nested large value refs for JavaScript instead of leaking ref markers', async () => {
    const { block, ctx } = createResolver('javascript')
    const state = new ExecutionState()
    state.setBlockOutput('producer', {
      result: {
        rows: {
          __simLargeValueRef: true,
          version: 1,
          id: 'lv_ABCDEFGHIJKL',
          kind: 'array',
          size: 12 * 1024 * 1024,
          key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json',
          executionId: 'execution-1',
        },
      },
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [createBlock('producer', 'Producer', BlockType.API), block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const largeResolver = new VariableResolver(workflow, {}, state)
    const largeCtx = {
      ...ctx,
      blockStates: state.getBlockStates(),
    } as ExecutionContext

    await expect(
      largeResolver.resolveInputsForFunctionBlock(
        largeCtx,
        'function',
        { code: 'return <Producer.result>.rows.length' },
        block
      )
    ).rejects.toThrow('This execution value contains nested large values')
  })

  it('resolves Python block references through globals lookup', async () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <Producer.result>' },
      block
    )

    expect(result.resolvedInputs.code).toBe('return globals()["__blockRef_0"]')
    expect(result.displayInputs.code).toBe('return "hello world"')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('breaks JavaScript string literals around quoted block references', async () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: "const rawEmail = '<Producer.result>';\nreturn rawEmail" },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      "const rawEmail = '' + JSON.stringify(globalThis[\"__blockRef_0\"]) + '';\nreturn rawEmail"
    )
    expect(result.displayInputs.code).toBe('const rawEmail = \'"hello world"\';\nreturn rawEmail')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('uses template interpolation for JavaScript template literal block references', async () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return `value: <Producer.result>`' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — asserting template literal is preserved
      'return `value: ${JSON.stringify(globalThis["__blockRef_0"])}`'
    )
    expect(result.displayInputs.code).toBe('return `value: "hello world"`')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('keeps JavaScript block references inside template expressions executable', async () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — asserting template literal is preserved
      { code: 'return `${String(<Producer.result>)}`' },
      block
    )

    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — asserting template literal is preserved
    expect(result.resolvedInputs.code).toBe('return `${String(globalThis["__blockRef_0"])}`')
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional — asserting template literal is preserved
    expect(result.displayInputs.code).toBe('return `${String("hello world")}`')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('ignores JavaScript comment quotes before later block references', async () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: "// don't confuse quote tracking\nreturn <Producer.result>" },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      '// don\'t confuse quote tracking\nreturn globalThis["__blockRef_0"]'
    )
    expect(result.displayInputs.code).toBe('// don\'t confuse quote tracking\nreturn "hello world"')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('breaks Python string literals around quoted block references', async () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: "raw_email = '<Producer.result>'\nreturn raw_email" },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      "raw_email = '' + json.dumps(globals()[\"__blockRef_0\"]) + ''\nreturn raw_email"
    )
    expect(result.displayInputs.code).toBe('raw_email = \'"hello world"\'\nreturn raw_email')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('breaks Python triple-double-quoted strings around block references', async () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'prompt = """\nSummary: <Producer.result>\n"""\nreturn prompt' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      'prompt = """\nSummary: """ + json.dumps(globals()["__blockRef_0"]) + """\n"""\nreturn prompt'
    )
    expect(result.displayInputs.code).toBe(
      'prompt = """\nSummary: "hello world"\n"""\nreturn prompt'
    )
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('ignores escaped triple-double quotes before later Python block references', async () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'prompt = """Escaped delimiter: \\"\\"\\"\nSummary: <Producer.result>\n"""' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      'prompt = """Escaped delimiter: \\"\\"\\"\nSummary: """ + json.dumps(globals()["__blockRef_0"]) + """\n"""'
    )
    expect(result.displayInputs.code).toBe(
      'prompt = """Escaped delimiter: \\"\\"\\"\nSummary: "hello world"\n"""'
    )
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('breaks Python triple-single-quoted strings around block references', async () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: "prompt = '''\nSummary: <Producer.result>\n'''\nreturn prompt" },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      "prompt = '''\nSummary: ''' + json.dumps(globals()[\"__blockRef_0\"]) + '''\n'''\nreturn prompt"
    )
    expect(result.displayInputs.code).toBe(
      "prompt = '''\nSummary: \"hello world\"\n'''\nreturn prompt"
    )
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('ignores Python comment quotes before later block references', async () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: "# don't confuse quote tracking\nreturn <Producer.result>" },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      '# don\'t confuse quote tracking\nreturn globals()["__blockRef_0"]'
    )
    expect(result.displayInputs.code).toBe('# don\'t confuse quote tracking\nreturn "hello world"')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('uses separate Python context variables for repeated mutable references', async () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'a = <Producer.items>\nb = <Producer.items>\nreturn b' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      'a = globals()["__blockRef_0"]\nb = globals()["__blockRef_1"]\nreturn b'
    )
    expect(result.displayInputs.code).toBe(
      'a = json.loads("[\\"a\\",\\"b\\"]")\nb = json.loads("[\\"a\\",\\"b\\"]")\nreturn b'
    )
    expect(result.contextVariables).toEqual({
      __blockRef_0: ['a', 'b'],
      __blockRef_1: ['a', 'b'],
    })
  })

  it('uses shell-safe expansions for block references', async () => {
    const { block, ctx, resolver } = createResolver('shell')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'echo <Producer.result>suffix && echo "<Producer.result>"' },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      `echo "\${__blockRef_0}"suffix && echo "\${__blockRef_1}"`
    )
    expect(result.displayInputs.code).toBe('echo "hello world"suffix && echo "hello world"')
    expect(result.contextVariables).toEqual({
      __blockRef_0: 'hello world',
      __blockRef_1: 'hello world',
    })
  })

  it('ignores shell comment quotes when formatting later block references', async () => {
    const { block, ctx, resolver } = createResolver('shell')

    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: "# don't confuse quote tracking\necho <Producer.result>" },
      block
    )

    expect(result.resolvedInputs.code).toBe(
      `# don't confuse quote tracking\necho "\${__blockRef_0}"`
    )
    expect(result.displayInputs.code).toBe('# don\'t confuse quote tracking\necho "hello world"')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })
})

describe('VariableResolver function context overflow offload', () => {
  const REF_KEY = 'execution/workspace-1/workflow-1/execution-1/large-value-lv_ABCDEFGHIJKL.json'

  function createOffloadEnv(language: string, producerOutput: Record<string, unknown>) {
    const { block, ctx } = createResolver(language)
    const producer = createBlock('producer', 'Producer', BlockType.API)
    const state = new ExecutionState()
    state.setBlockOutput('producer', producerOutput)
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [producer, block],
      connections: [],
      loops: {},
      parallels: {},
    }
    const resolver = new VariableResolver(workflow, {}, state)
    const durableCtx = {
      ...ctx,
      blockStates: state.getBlockStates(),
      workspaceId: 'workspace-1',
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      largeValueKeys: [] as string[],
    } as ExecutionContext
    return { block, resolver, durableCtx }
  }

  beforeEach(() => {
    mockStoreLargeValue.mockReset()
    mockStoreLargeValue.mockResolvedValue({
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_ABCDEFGHIJKL',
      kind: 'string',
      size: 4 * 1024 * 1024,
      key: REF_KEY,
      executionId: 'execution-1',
    })
  })

  it('offloads an oversized inline value to a lazily-read large-value ref', async () => {
    const big = 'x'.repeat(4 * 1024 * 1024)
    const { block, resolver, durableCtx } = createOffloadEnv('javascript', { result: big })

    const result = await resolver.resolveInputsForFunctionBlock(
      durableCtx,
      'function',
      { code: 'return <Producer.result>' },
      block
    )

    expect(mockStoreLargeValue).toHaveBeenCalledTimes(1)
    expect(result.resolvedInputs.code).toBe(
      'return (await sim.values.read(globalThis["__blockRef_0"]))'
    )
    expect(result.contextVariables.__blockRef_0).toMatchObject({
      __simLargeValueRef: true,
      id: 'lv_ABCDEFGHIJKL',
    })
    // The bulky value must not be inlined into either the request data or display source,
    // and the Input view shows a readable placeholder instead of the raw ref object.
    expect(result.displayInputs.code.length).toBeLessThan(1024)
    expect(result.displayInputs.code).not.toContain('__simLargeValueRef')
    expect(result.displayInputs.code).toContain('large string')
    // The route must be authorized to materialize the ref it is about to receive.
    expect(durableCtx.largeValueKeys).toContain(REF_KEY)
  })

  it('offloads only the values that overflow the budget when several are merged', async () => {
    // Each value's inline footprint (data + display ~= 2x) is ~4 MB. The first fits the
    // ~6 MB budget and stays inline; the second overflows and is offloaded.
    const half = 'y'.repeat(2 * 1024 * 1024)
    const { block, resolver, durableCtx } = createOffloadEnv('javascript', {
      first: half,
      second: half,
    })

    const result = await resolver.resolveInputsForFunctionBlock(
      durableCtx,
      'function',
      { code: 'return [<Producer.first>, <Producer.second>]' },
      block
    )

    // First value fits the budget and stays inline; the second overflows and is offloaded.
    expect(mockStoreLargeValue).toHaveBeenCalledTimes(1)
    expect(result.resolvedInputs.code).toBe(
      'return [globalThis["__blockRef_0"], (await sim.values.read(globalThis["__blockRef_1"]))]'
    )
    expect(result.contextVariables.__blockRef_0).toBe(half)
    expect(result.contextVariables.__blockRef_1).toMatchObject({ __simLargeValueRef: true })
  })

  it('keeps small inline values inline without offloading', async () => {
    const { block, resolver, durableCtx } = createOffloadEnv('javascript', {
      result: 'hello world',
    })

    const result = await resolver.resolveInputsForFunctionBlock(
      durableCtx,
      'function',
      { code: 'return <Producer.result>' },
      block
    )

    expect(mockStoreLargeValue).not.toHaveBeenCalled()
    expect(result.resolvedInputs.code).toBe('return globalThis["__blockRef_0"]')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('does not offload when the execution context cannot persist durably', async () => {
    const big = 'x'.repeat(4 * 1024 * 1024)
    const { block, resolver, durableCtx } = createOffloadEnv('javascript', { result: big })
    durableCtx.executionId = undefined

    const result = await resolver.resolveInputsForFunctionBlock(
      durableCtx,
      'function',
      { code: 'return <Producer.result>' },
      block
    )

    expect(mockStoreLargeValue).not.toHaveBeenCalled()
    expect(result.resolvedInputs.code).toBe('return globalThis["__blockRef_0"]')
  })

  it('does not offload for non-JavaScript runtimes that lack the read broker', async () => {
    const big = 'x'.repeat(4 * 1024 * 1024)
    const { block, resolver, durableCtx } = createOffloadEnv('python', { result: big })

    const result = await resolver.resolveInputsForFunctionBlock(
      durableCtx,
      'function',
      { code: 'return <Producer.result>' },
      block
    )

    expect(mockStoreLargeValue).not.toHaveBeenCalled()
    expect(result.resolvedInputs.code).toBe('return globals()["__blockRef_0"]')
  })
})

/**
 * The agent block's Reasoning Effort and Verbosity fields are editable comboboxes, so a
 * workflow can bind them to a reference instead of picking a level. These lock in that the
 * generic input resolution actually reaches those two fields.
 */
describe('VariableResolver agent model levels', () => {
  it('resolves block, workflow-variable, and env references in reasoning effort and verbosity', async () => {
    const producer = createBlock('producer', 'Producer', BlockType.API)
    const agent = createBlock('agent', 'Agent', BlockType.AGENT, {
      model: 'gpt-5',
      reasoningEffort: '<Producer.result>',
      verbosity: '<variable.Detail>',
      thinkingLevel: '{{THINKING}}',
    })
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [producer, agent],
      connections: [],
      loops: {},
      parallels: {},
    }

    const state = new ExecutionState()
    state.setBlockOutput('producer', { result: 'high' })
    const ctx = {
      blockStates: state.getBlockStates(),
      blockLogs: [],
      environmentVariables: { THINKING: 'medium' },
      workflowVariables: { 'var-1': { id: 'var-1', name: 'Detail', type: 'string', value: 'low' } },
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      completedLoops: new Set(),
      metadata: {},
    } as unknown as ExecutionContext

    const resolver = new VariableResolver(workflow, { THINKING: 'medium' }, state)
    const result = await resolver.resolveInputs(ctx, 'agent', agent.config.params, agent)

    expect(result.reasoningEffort).toBe('high')
    expect(result.verbosity).toBe('low')
    expect(result.thinkingLevel).toBe('medium')
    expect(result.model).toBe('gpt-5')
  })
})
