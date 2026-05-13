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
      file: 'file',
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
    resolver: new VariableResolver(workflow, {}, state),
  }
}

describe('VariableResolver function block inputs', () => {
  it('returns empty inputs when params are missing', async () => {
    const { block, ctx, resolver } = createResolver()

    const result = await resolver.resolveInputsForFunctionBlock(ctx, 'function', undefined, block)

    expect(result).toEqual({ resolvedInputs: {}, displayInputs: {}, contextVariables: {} })
  })

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
