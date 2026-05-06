import { describe, expect, it } from 'vitest'
import { StartBlockPath } from '@/lib/workflows/triggers/triggers'
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
  it.concurrent('buildResolutionFromBlock returns null when metadata id missing', () => {
    const block = createBlock('api_trigger')
    ;(block.metadata as Record<string, unknown>).id = undefined

    expect(buildResolutionFromBlock(block)).toBeNull()
  })

  it.concurrent('resolveExecutorStartBlock prefers unified start block', () => {
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

  it.concurrent('buildStartBlockOutput normalizes unified start payload', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workflowInput: { payload: 'value' },
    })

    expect(output.payload).toBe('value')
    expect(output.input).toBeUndefined()
    expect(output.conversationId).toBeUndefined()
  })

  it.concurrent('buildStartBlockOutput uses trigger schema for API triggers', () => {
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
    })

    expect(output.name).toBe('Ada')
    expect(output.input).toEqual({ name: 'Ada', count: 5 })
    expect(output.files).toEqual(files)
  })

  it.concurrent('rejects inputFormat fields that collide with executor routing keys', () => {
    const block = createBlock('start_trigger', 'start', {
      subBlocks: {
        inputFormat: {
          value: [
            { name: 'error', type: 'string' },
            { name: 'error', type: 'string' },
            { name: ' selectedOption ', type: 'string' },
            { name: 'selectedRoute', type: 'string' },
            { name: '_pauseMetadata', type: 'object' },
          ],
        },
      },
    })

    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    expect(() =>
      buildStartBlockOutput({
        resolution,
        workflowInput: { error: false, selectedRoute: 'source' },
      })
    ).toThrow(
      'Start block "block-start_trigger" cannot use reserved input format field name(s): error, selectedOption, selectedRoute, _pauseMetadata'
    )
  })

  it.concurrent(
    'rejects reserved top-level runtime input keys copied to unified Start output',
    () => {
      const block = createBlock('start_trigger', 'start')
      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.UNIFIED,
      } as const

      expect(() =>
        buildStartBlockOutput({
          resolution,
          workflowInput: { error: 'false', payload: 'value' },
        })
      ).toThrow(
        'Start block "block-start_trigger" cannot use reserved runtime input field name(s): error'
      )
    }
  )

  it.concurrent('rejects reserved nested API input keys copied to trigger output', () => {
    const block = createBlock('api_trigger', 'api')
    const resolution = {
      blockId: 'api',
      block,
      path: StartBlockPath.SPLIT_API,
    } as const

    expect(() =>
      buildStartBlockOutput({
        resolution,
        workflowInput: { input: { selectedRoute: 'route-1', payload: 'value' } },
      })
    ).toThrow(
      'Start block "block-api_trigger" cannot use reserved runtime input field name(s): selectedRoute'
    )
  })

  it.concurrent('allows reserved inputFormat field names on split chat trigger output', () => {
    const block = createBlock('chat_trigger', 'chat', {
      subBlocks: {
        inputFormat: {
          value: [{ name: 'error', type: 'string' }],
        },
      },
    })
    const resolution = {
      blockId: 'chat',
      block,
      path: StartBlockPath.SPLIT_CHAT,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workflowInput: { input: 'hello', conversationId: 'conversation-1' },
    })

    expect(output).toEqual({ input: 'hello', conversationId: 'conversation-1' })
  })

  it.concurrent('allows reserved inputFormat field names on legacy chat starter output', () => {
    const block = createBlock('starter', 'starter', {
      subBlocks: {
        startWorkflow: { value: 'chat' },
        inputFormat: {
          value: [{ name: 'error', type: 'string' }],
        },
      },
    })
    const resolution = {
      blockId: 'starter',
      block,
      path: StartBlockPath.LEGACY_STARTER,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workflowInput: { input: 'hello' },
    })

    expect(output).toEqual({ input: 'hello' })
  })

  it.concurrent('allows reserved inputFormat field names on serialized legacy chat starter', () => {
    const block = createBlock('starter', 'starter')
    block.config.params = {
      startWorkflow: 'chat',
      inputFormat: [{ name: 'error', type: 'string' }],
    }
    const resolution = {
      blockId: 'starter',
      block,
      path: StartBlockPath.LEGACY_STARTER,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workflowInput: { input: 'hello' },
    })

    expect(output).toEqual({ input: 'hello' })
  })

  it.concurrent('ignores malformed non-string inputFormat field names', () => {
    const block = createBlock('start_trigger', 'start', {
      subBlocks: {
        inputFormat: {
          value: [
            { name: 123, type: 'string', value: 'ignored' },
            { name: 'customField', type: 'string' },
          ],
        },
      },
    })
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workflowInput: { customField: 'value' },
    })

    expect(output.customField).toBe('value')
    expect(output[123]).toBeUndefined()
  })

  describe('inputFormat default values', () => {
    it.concurrent('uses default value when runtime does not provide the field', () => {
      const block = createBlock('start_trigger', 'start', {
        subBlocks: {
          inputFormat: {
            value: [
              { name: 'input', type: 'string' },
              { name: 'customField', type: 'string', value: 'defaultValue' },
            ],
          },
        },
      })

      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.UNIFIED,
      } as const

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: { input: 'hello' },
      })

      expect(output.input).toBe('hello')
      expect(output.customField).toBe('defaultValue')
    })

    it.concurrent('runtime value overrides default value', () => {
      const block = createBlock('start_trigger', 'start', {
        subBlocks: {
          inputFormat: {
            value: [{ name: 'customField', type: 'string', value: 'defaultValue' }],
          },
        },
      })

      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.UNIFIED,
      } as const

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: { customField: 'runtimeValue' },
      })

      expect(output.customField).toBe('runtimeValue')
    })

    it.concurrent('empty string from runtime overrides default value', () => {
      const block = createBlock('start_trigger', 'start', {
        subBlocks: {
          inputFormat: {
            value: [{ name: 'customField', type: 'string', value: 'defaultValue' }],
          },
        },
      })

      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.UNIFIED,
      } as const

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: { customField: '' },
      })

      expect(output.customField).toBe('')
    })

    it.concurrent('null from runtime does not override default value', () => {
      const block = createBlock('start_trigger', 'start', {
        subBlocks: {
          inputFormat: {
            value: [{ name: 'customField', type: 'string', value: 'defaultValue' }],
          },
        },
      })

      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.UNIFIED,
      } as const

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: { customField: null },
      })

      expect(output.customField).toBe('defaultValue')
    })

    it.concurrent('preserves coerced types for unified start payload', () => {
      const block = createBlock('start_trigger', 'start', {
        subBlocks: {
          inputFormat: {
            value: [
              { name: 'conversation_id', type: 'number' },
              { name: 'sender', type: 'object' },
              { name: 'is_active', type: 'boolean' },
            ],
          },
        },
      })

      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.UNIFIED,
      } as const

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: {
          conversation_id: '149',
          sender: '{"id":10,"email":"user@example.com"}',
          is_active: 'true',
        },
      })

      expect(output.conversation_id).toBe(149)
      expect(output.sender).toEqual({ id: 10, email: 'user@example.com' })
      expect(output.is_active).toBe(true)
    })

    it.concurrent(
      'prefers coerced inputFormat values over duplicated top-level workflowInput keys',
      () => {
        const block = createBlock('start_trigger', 'start', {
          subBlocks: {
            inputFormat: {
              value: [
                { name: 'conversation_id', type: 'number' },
                { name: 'sender', type: 'object' },
                { name: 'is_active', type: 'boolean' },
              ],
            },
          },
        })

        const resolution = {
          blockId: 'start',
          block,
          path: StartBlockPath.UNIFIED,
        } as const

        const output = buildStartBlockOutput({
          resolution,
          workflowInput: {
            input: {
              conversation_id: '149',
              sender: '{"id":10,"email":"user@example.com"}',
              is_active: 'false',
            },
            conversation_id: '150',
            sender: '{"id":99,"email":"wrong@example.com"}',
            is_active: 'true',
            extra: 'keep-me',
          },
        })

        expect(output.conversation_id).toBe(149)
        expect(output.sender).toEqual({ id: 10, email: 'user@example.com' })
        expect(output.is_active).toBe(false)
        expect(output.extra).toBe('keep-me')
      }
    )
  })

  describe('EXTERNAL_TRIGGER path', () => {
    it.concurrent('rejects reserved runtime input keys copied to external trigger output', () => {
      const block = createBlock('webhook', 'start')
      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.EXTERNAL_TRIGGER,
      } as const

      expect(() =>
        buildStartBlockOutput({
          resolution,
          workflowInput: { _pauseMetadata: { contextId: 'fake-pause' }, payload: 'value' },
        })
      ).toThrow(
        'Start block "block-webhook" cannot use reserved runtime input field name(s): _pauseMetadata'
      )
    })

    it.concurrent('preserves coerced types for integration trigger payload', () => {
      const block = createBlock('webhook', 'start', {
        subBlocks: {
          inputFormat: {
            value: [
              { name: 'count', type: 'number' },
              { name: 'payload', type: 'object' },
            ],
          },
        },
      })

      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.EXTERNAL_TRIGGER,
      } as const

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: {
          count: '5',
          payload: '{"event":"push"}',
          extra: 'untouched',
        },
      })

      expect(output.count).toBe(5)
      expect(output.payload).toEqual({ event: 'push' })
      expect(output.extra).toBe('untouched')
    })
  })
})
