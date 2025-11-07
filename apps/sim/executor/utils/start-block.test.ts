import { describe, expect, it } from 'vitest'
import { StartBlockPath } from '@/lib/workflows/triggers'
import type { UserFile } from '@/executor/types'
import {
  buildResolutionFromBlock,
  buildStartBlockOutput,
  resolveExecutorStartBlock,
} from '@/executor/utils/start-block'
import type { SerializedBlock } from '@/serializer/types'

function createBlock(
  type: string,
  id = type,
  options?: { subBlocks?: Record<string, unknown> }
): SerializedBlock {
  return {
    id,
    position: { x: 0, y: 0 },
    config: {
      tool: type,
      params: options?.subBlocks?.inputFormat ? { inputFormat: options.subBlocks.inputFormat } : {},
    },
    inputs: {},
    outputs: {},
    metadata: {
      id: type,
      name: `block-${type}`,
      category: 'triggers',
      ...(options?.subBlocks ? { subBlocks: options.subBlocks } : {}),
    } as SerializedBlock['metadata'] & { subBlocks?: Record<string, unknown> },
    enabled: true,
  }
}

describe('start-block utilities', () => {
  it('buildResolutionFromBlock returns null when metadata id missing', () => {
    const block = createBlock('api_trigger')
    ;(block.metadata as Record<string, unknown>).id = undefined

    expect(buildResolutionFromBlock(block)).toBeNull()
  })

  it('resolveExecutorStartBlock prefers unified start block', () => {
    const blocks = [
      createBlock('api_trigger', 'api'),
      createBlock('starter', 'starter'),
      createBlock('start_trigger', 'start'),
    ]

    const resolution = resolveExecutorStartBlock(blocks, {
      execution: 'api',
      isChildWorkflow: false,
    })

    expect(resolution?.blockId).toBe('start')
    expect(resolution?.path).toBe(StartBlockPath.UNIFIED)
  })

  it('buildStartBlockOutput normalizes unified start payload', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workflowInput: { payload: 'value' },
      isDeployedExecution: true,
    })

    expect(output.payload).toBe('value')
    expect(output.input).toBeUndefined()
    expect(output.conversationId).toBeUndefined()
  })

  it('buildStartBlockOutput uses trigger schema for API triggers', () => {
    const apiBlock = createBlock('api_trigger', 'api', {
      subBlocks: {
        inputFormat: {
          value: [
            { name: 'name', type: 'string' },
            { name: 'count', type: 'number' },
          ],
        },
      },
    })

    const resolution = {
      blockId: 'api',
      block: apiBlock,
      path: StartBlockPath.SPLIT_API,
    } as const

    const files: UserFile[] = [
      {
        id: 'file-1',
        name: 'document.txt',
        url: 'https://example.com/document.txt',
        size: 42,
        type: 'text/plain',
        key: 'file-key',
      },
    ]

    const output = buildStartBlockOutput({
      resolution,
      workflowInput: {
        input: {
          name: 'Ada',
          count: '5',
        },
        files,
      },
      isDeployedExecution: false,
    })

    expect(output.name).toBe('Ada')
    expect(output.input).toEqual({ name: 'Ada', count: 5 })
    expect(output.files).toEqual(files)
  })
})
