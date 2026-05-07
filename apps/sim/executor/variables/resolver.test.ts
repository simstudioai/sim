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

    expect(result).toEqual({ resolvedInputs: {}, contextVariables: {} })
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
    expect(result.contextVariables).toEqual({ __blockRef_0: 'hello world' })
  })
})
