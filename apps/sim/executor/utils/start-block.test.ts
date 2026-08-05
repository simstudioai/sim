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

  it.concurrent(
    'resolves the unified start block for form submissions and coerces values per inputFormat',
    () => {
      const startBlock = createBlock('start_trigger', 'start', {
        subBlocks: {
          inputFormat: {
            value: [
              { name: 'quantity', type: 'number' },
              { name: 'subscribed', type: 'boolean' },
              { name: 'notes', type: 'string' },
            ],
          },
        },
      })

      const resolution = resolveExecutorStartBlock([startBlock], {
        execution: 'api',
        isChildWorkflow: false,
      })

      expect(resolution?.blockId).toBe('start')
      expect(resolution?.path).toBe(StartBlockPath.UNIFIED)
      if (!resolution) return

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: { quantity: '5', subscribed: 'true', notes: 'hello' },
      })

      expect(output.quantity).toBe(5)
      expect(output.subscribed).toBe(true)
      expect(output.notes).toBe('hello')
    }
  )

  it.concurrent('buildStartBlockOutput normalizes Start files from internal serve URLs', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'screenshot.png',
            url: '/api/files/serve/s3/execution%2Fworkspace-id%2Fworkflow-id%2Fexecution-id%2Fscreenshot.png?context=execution',
            size: 243289,
            type: 'image/png',
          },
        ],
      },
    })

    expect(output.files).toEqual([
      {
        id: 'file_1',
        name: 'screenshot.png',
        url: '/api/files/serve/s3/execution%2Fworkspace-id%2Fworkflow-id%2Fexecution-id%2Fscreenshot.png?context=execution',
        size: 243289,
        type: 'image/png',
        key: 'execution/workspace-id/workflow-id/execution-id/screenshot.png',
        context: 'execution',
      },
    ])
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

  describe('form trigger submissions', () => {
    it.concurrent('lands every submitted field as a top-level Start output', () => {
      const block = createBlock('start_trigger', 'start')
      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.UNIFIED,
      } as const

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: { email: 'ada@sim.ai', message: 'hello', subscribed: false },
      })

      expect(output.email).toBe('ada@sim.ai')
      expect(output.message).toBe('hello')
      expect(output.subscribed).toBe(false)
      expect(output.input).toBeUndefined()
      expect(output).not.toHaveProperty('conversationId')
    })

    it.concurrent('passes undeclared fields through alongside inputFormat-coerced ones', () => {
      const block = createBlock('start_trigger', 'start', {
        subBlocks: {
          inputFormat: {
            value: [{ name: 'quantity', type: 'number' }],
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
        workflowInput: { quantity: '7', notes: 'ship fast', subscribed: false },
      })

      expect(output.quantity).toBe(7)
      expect(output.notes).toBe('ship fast')
      expect(output.subscribed).toBe(false)
    })

    it.concurrent('keeps a submitted false switch value over the inputFormat default', () => {
      const block = createBlock('start_trigger', 'start', {
        subBlocks: {
          inputFormat: {
            value: [{ name: 'subscribed', type: 'boolean', value: true }],
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
        workflowInput: { subscribed: false },
      })

      expect(output.subscribed).toBe(false)
    })

    it.concurrent('enters a legacy API-trigger workflow at its API trigger', () => {
      const resolution = resolveExecutorStartBlock([createBlock('api_trigger', 'api')], {
        execution: 'api',
        isChildWorkflow: false,
      })

      expect(resolution?.blockId).toBe('api')
      expect(resolution?.path).toBe(StartBlockPath.SPLIT_API)
    })

    it.concurrent('resolves no start block for a chat-only workflow', () => {
      const resolution = resolveExecutorStartBlock([createBlock('chat_trigger', 'chat')], {
        execution: 'api',
        isChildWorkflow: false,
      })

      expect(resolution).toBeNull()
    })
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

  describe('run metadata injection', () => {
    const runMetadata = {
      userEmail: 'real@sim.ai',
      workspaceId: 'ws-1',
      workflowId: 'wf-1',
      executionId: 'exec-1',
      executionType: 'api',
      executionMode: 'sync' as const,
      startTime: '2026-07-15T00:00:00.000Z',
    }

    function createUnifiedResolution(subBlocks?: Record<string, unknown>) {
      const block = createBlock('start_trigger', 'start', subBlocks ? { subBlocks } : undefined)
      return {
        blockId: 'start',
        block,
        path: StartBlockPath.UNIFIED,
      } as const
    }

    it.concurrent('server metadata overrides caller-supplied metadata key', () => {
      const resolution = createUnifiedResolution({ runMetadata: { value: true } })

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: {
          metadata: { userEmail: 'attacker@x.com' },
          simUserEmail: 'attacker@x.com',
          payload: 'value',
        },
        runMetadata,
      })

      expect(output.metadata).toEqual(runMetadata)
      expect(output.payload).toBe('value')
      expect(output.simUserEmail).toBe('attacker@x.com')
    })

    it.concurrent('strips caller-supplied metadata key when no trusted metadata exists', () => {
      const resolution = createUnifiedResolution({ runMetadata: { value: true } })

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: { metadata: { userEmail: 'attacker@x.com' } },
      })

      expect(output).not.toHaveProperty('metadata')
    })

    it.concurrent('throws when an input format field is named metadata', () => {
      const resolution = createUnifiedResolution({
        runMetadata: { value: true },
        inputFormat: { value: [{ name: 'metadata', type: 'string' }] },
      })

      expect(() =>
        buildStartBlockOutput({
          resolution,
          workflowInput: {},
          runMetadata,
        })
      ).toThrow('reserves the "metadata" output')
    })

    it.concurrent('toggle off leaves caller-supplied metadata untouched', () => {
      const resolution = createUnifiedResolution()

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: { metadata: { custom: 'value' } },
        runMetadata,
      })

      expect(output.metadata).toEqual({ custom: 'value' })
    })

    it.concurrent('reads the toggle from config params when metadata subBlocks are absent', () => {
      const block = createBlock('start_trigger', 'start')
      block.config.params.runMetadata = true
      const resolution = {
        blockId: 'start',
        block,
        path: StartBlockPath.UNIFIED,
      } as const

      const output = buildStartBlockOutput({
        resolution,
        workflowInput: { metadata: 'spoof' },
        runMetadata,
      })

      expect(output.metadata).toEqual(runMetadata)
    })
  })
})
