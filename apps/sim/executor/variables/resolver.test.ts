import { encryptionMock, encryptionMockFns } from '@sim/testing/mocks/encryption.mock'
import {
  executionPayloadStoreMock,
  executionPayloadStoreMockFns,
} from '@sim/testing/mocks/execution-payload-store.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { compileCodePlaceholders } from '@/lib/execution/code-placeholders'
import { CodeLanguage } from '@/lib/execution/languages'
import { projectResolvedModelInput } from '@/lib/execution/model-input-provenance'
import {
  LARGE_ARRAY_MANIFEST_VERSION,
  type LargeArrayManifest,
} from '@/lib/execution/payloads/large-array-manifest-metadata'
import {
  collectSandboxFileMountRefs,
  replaceSandboxFileMountRefs,
} from '@/lib/execution/payloads/sandbox-file-mount-ref'
import { StartBlockPath } from '@/lib/workflows/triggers/triggers'
import { BlockType } from '@/executor/constants'
import { ExecutionState } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { buildStartBlockOutput } from '@/executor/utils/start-block'
import { VariableResolver } from '@/executor/variables/resolver'
import { navigatePathAsync } from '@/executor/variables/resolvers/reference-async.server'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const { mockStoreLargeValue } = executionPayloadStoreMockFns

encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
  decrypted: encryptedValue,
}))

vi.mock('@/lib/execution/payloads/store', () => executionPayloadStoreMock)

vi.mock('@/lib/core/security/encryption', () => encryptionMock)

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

describe('Start file path references', () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111'
  const key = `workspace/${workspaceId}/photo.png`
  const uploadedFile = {
    id: 'file-1',
    name: 'photo.png',
    size: 128,
    type: 'image/png',
  }

  it.each([
    {
      language: 'shell',
      file: { ...uploadedFile, key, url: 'https://storage.example.com/photo.png' },
    },
    {
      language: 'shell',
      file: {
        ...uploadedFile,
        url: `/api/files/serve/s3/${encodeURIComponent(key)}?context=workspace`,
      },
    },
    {
      language: 'python',
      file: { ...uploadedFile, key, url: 'https://storage.example.com/photo.png' },
    },
    {
      language: 'javascript',
      file: { ...uploadedFile, key, url: 'https://storage.example.com/photo.png' },
    },
  ])('mounts a Start upload referenced from $language code', async ({ language, file }) => {
    const start = createBlock('start', 'Start', 'start_trigger', {
      inputFormat: [{ name: 'files', type: 'file[]', value: '' }],
    })
    const functionBlock = createBlock('function', 'Function', BlockType.FUNCTION, { language })
    const output = buildStartBlockOutput({
      resolution: { blockId: start.id, block: start, path: StartBlockPath.UNIFIED },
      workspaceId,
      workflowInput: { input: 'Edit the image', files: [file] },
    })
    const { ctx } = createResolver(language)
    const state = new ExecutionState()
    state.setBlockOutput(start.id, output)
    ctx.blockStates = state.getBlockStates()
    const workflow: SerializedWorkflow = {
      version: '1',
      blocks: [start, functionBlock],
      connections: [],
      loops: {},
      parallels: {},
    }
    const resolver = new VariableResolver(workflow, {}, state, { navigatePathAsync })
    const result = await resolver.resolveInputsForFunctionBlock(
      ctx,
      functionBlock.id,
      { code: 'IN="<start.files[0].path>"' },
      functionBlock
    )

    expect(collectSandboxFileMountRefs(result.contextVariables)).toEqual([
      { ...file, key, context: 'workspace' },
    ])
    expect(
      replaceSandboxFileMountRefs(result.contextVariables, () => '/tmp/sim/inputs/photo.png')
    ).toEqual({ __blockRef_0: '/tmp/sim/inputs/photo.png' })
    expect(result.resolvedInputs.code).not.toContain('<start.files[0].path>')
    expect(result.resolvedInputs.code).not.toContain('null')
    if (language === 'shell') {
      expect(result.resolvedInputs.code).toBe(`IN="\${__blockRef_0}"`)
    }
  })
})

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
      tools: [
        {
          type: 'search',
          usageControl: 'auto',
          usageControlExpression: '<variable.Detail>',
        },
      ],
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
    expect(result.tools[0].usageControlExpression).toBe('low')
    expect(result.model).toBe('gpt-5')
  })
})
