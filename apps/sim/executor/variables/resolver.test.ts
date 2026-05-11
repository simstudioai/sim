/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/constants'
import { ExecutionState } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
import { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

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
    },
    enabled: true,
  }
}

function createResolver(language = 'javascript') {
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
    resolver: new VariableResolver(workflow, {}, state),
  }
}

describe('VariableResolver function block inputs', () => {
  it('returns empty inputs when params are missing', () => {
    const { block, ctx, resolver } = createResolver()

    const result = resolver.resolveInputsForFunctionBlock(ctx, 'function', undefined, block)

    expect(result).toEqual({ resolvedInputs: {}, displayInputs: {}, contextVariables: {} })
  })

  it('resolves JavaScript block references through globalThis context variables', () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <Producer.result>' },
      block
    )

    expect(result.resolvedInputs.code).toBe('return globalThis["__blockRef_0"]')
    expect(result.displayInputs.code).toBe('return "hello world"')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('resolves Python block references through globals lookup', () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = resolver.resolveInputsForFunctionBlock(
      ctx,
      'function',
      { code: 'return <Producer.result>' },
      block
    )

    expect(result.resolvedInputs.code).toBe('return globals()["__blockRef_0"]')
    expect(result.displayInputs.code).toBe('return "hello world"')
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })

  it('breaks JavaScript string literals around quoted block references', () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('uses template interpolation for JavaScript template literal block references', () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('keeps JavaScript block references inside template expressions executable', () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('ignores JavaScript comment quotes before later block references', () => {
    const { block, ctx, resolver } = createResolver('javascript')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('breaks Python string literals around quoted block references', () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('breaks Python triple-double-quoted strings around block references', () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('ignores escaped triple-double quotes before later Python block references', () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('breaks Python triple-single-quoted strings around block references', () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('ignores Python comment quotes before later block references', () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('uses separate Python context variables for repeated mutable references', () => {
    const { block, ctx, resolver } = createResolver('python')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('uses shell-safe expansions for block references', () => {
    const { block, ctx, resolver } = createResolver('shell')

    const result = resolver.resolveInputsForFunctionBlock(
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

  it('ignores shell comment quotes when formatting later block references', () => {
    const { block, ctx, resolver } = createResolver('shell')

    const result = resolver.resolveInputsForFunctionBlock(
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
