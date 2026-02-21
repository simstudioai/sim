import { describe, expect, it } from 'vitest'
import { BlockType } from '@/executor/constants'
import { ExecutionState } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
import { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

function createSerializedBlock(opts: { id: string; name: string; type: string }): SerializedBlock {
  return {
    id: opts.id,
    position: { x: 0, y: 0 },
    config: { tool: opts.type, params: {} },
    inputs: {},
    outputs: {},
    metadata: { id: opts.type, name: opts.name },
    enabled: true,
  }
}

describe('VariableResolver', () => {
  it.concurrent('preserves typed values for workflow_input pure references', () => {
    const workflow: SerializedWorkflow = {
      version: 'test',
      blocks: [createSerializedBlock({ id: 'webhook', name: 'webhook', type: BlockType.TRIGGER })],
      connections: [],
      loops: {},
      parallels: {},
    }

    const state = new ExecutionState()
    state.setBlockOutput('webhook', {
      conversation_id: 149,
      sender: { id: 10, email: 'user@example.com' },
      is_active: true,
    })

    const resolver = new VariableResolver(workflow, {}, state)
    const ctx = { blockStates: new Map() } as unknown as ExecutionContext

    const workflowInputBlock = createSerializedBlock({
      id: 'wf',
      name: 'Workflow',
      type: BlockType.WORKFLOW_INPUT,
    })

    const resolved = resolver.resolveInputs(
      ctx,
      'wf',
      {
        inputMapping: {
          conversation_id: '<webhook.conversation_id>',
          sender: '<webhook.sender>',
          is_active: '<webhook.is_active>',
        },
      },
      workflowInputBlock
    )

    expect(resolved.inputMapping.conversation_id).toBe(149)
    expect(resolved.inputMapping.sender).toEqual({ id: 10, email: 'user@example.com' })
    expect(resolved.inputMapping.is_active).toBe(true)
  })

  it.concurrent('formats pure references for non-workflow blocks', () => {
    const workflow: SerializedWorkflow = {
      version: 'test',
      blocks: [createSerializedBlock({ id: 'webhook', name: 'webhook', type: BlockType.TRIGGER })],
      connections: [],
      loops: {},
      parallels: {},
    }

    const state = new ExecutionState()
    state.setBlockOutput('webhook', { conversation_id: 149 })

    const resolver = new VariableResolver(workflow, {}, state)
    const ctx = { blockStates: new Map() } as unknown as ExecutionContext

    const apiBlock = createSerializedBlock({
      id: 'api',
      name: 'API',
      type: BlockType.API,
    })

    const resolved = resolver.resolveInputs(
      ctx,
      'api',
      { conversation_id: '<webhook.conversation_id>' },
      apiBlock
    )

    expect(resolved.conversation_id).toBe('149')
  })

  it.concurrent('preserves nulls and arrays for workflow blocks with pure references', () => {
    const workflow: SerializedWorkflow = {
      version: 'test',
      blocks: [createSerializedBlock({ id: 'webhook', name: 'webhook', type: BlockType.TRIGGER })],
      connections: [],
      loops: {},
      parallels: {},
    }

    const state = new ExecutionState()
    state.setBlockOutput('webhook', {
      items: [1, { a: 2 }, [3]],
      nothing: null,
    })

    const resolver = new VariableResolver(workflow, {}, state)
    const ctx = { blockStates: new Map() } as unknown as ExecutionContext

    const workflowBlock = createSerializedBlock({
      id: 'wf',
      name: 'Workflow',
      type: BlockType.WORKFLOW,
    })

    const resolved = resolver.resolveInputs(
      ctx,
      'wf',
      {
        inputMapping: {
          items: '  <webhook.items>  ',
          nothing: '<webhook.nothing>',
        },
      },
      workflowBlock
    )

    expect(resolved.inputMapping.items).toEqual([1, { a: 2 }, [3]])
    expect(resolved.inputMapping.nothing).toBeNull()
  })

  it.concurrent('still stringifies when a reference is embedded in text', () => {
    const workflow: SerializedWorkflow = {
      version: 'test',
      blocks: [createSerializedBlock({ id: 'webhook', name: 'webhook', type: BlockType.TRIGGER })],
      connections: [],
      loops: {},
      parallels: {},
    }

    const state = new ExecutionState()
    state.setBlockOutput('webhook', { conversation_id: 149 })

    const resolver = new VariableResolver(workflow, {}, state)
    const ctx = { blockStates: new Map() } as unknown as ExecutionContext

    const workflowInputBlock = createSerializedBlock({
      id: 'wf',
      name: 'Workflow',
      type: BlockType.WORKFLOW_INPUT,
    })

    const resolved = resolver.resolveInputs(
      ctx,
      'wf',
      {
        label: 'id=<webhook.conversation_id>',
      },
      workflowInputBlock
    )

    expect(resolved.label).toBe('id=149')
  })
})
