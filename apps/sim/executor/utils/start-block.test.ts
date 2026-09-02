import { describe, expect, it } from 'vitest'
import { StartBlockPath } from '@/lib/workflows/triggers/triggers'
import type { UserFile } from '@/executor/types'
import {
  buildResolutionFromBlock,
  buildStartBlockOutput,
  resolveExecutorStartBlock,
  StartInputValidationError,
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

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_WORKSPACE_ID = '22222222-2222-4222-8222-222222222222'
const WORKFLOW_ID = '33333333-3333-4333-8333-333333333333'
const EXECUTION_ID = '44444444-4444-4444-8444-444444444444'
const EXECUTION_FILE_KEY = `execution/${WORKSPACE_ID}/${WORKFLOW_ID}/${EXECUTION_ID}/screenshot.png`
const EXECUTION_FILE_URL = `/api/files/serve/s3/${encodeURIComponent(EXECUTION_FILE_KEY)}?context=execution`

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
        url: `/api/files/serve/s3/${encodeURIComponent(`workspace/${WORKSPACE_ID}/document.txt`)}?context=workspace`,
        size: 42,
        type: 'text/plain',
        key: `workspace/${WORKSPACE_ID}/document.txt`,
        context: 'workspace',
      },
    ]

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
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

  it.concurrent('buildStartBlockOutput normalizes Start files from internal serve URLs', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'screenshot.png',
            url: EXECUTION_FILE_URL,
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
        url: EXECUTION_FILE_URL,
        size: 243289,
        type: 'image/png',
        key: EXECUTION_FILE_KEY,
        context: 'execution',
      },
    ])
  })

  it.concurrent('drops a storage key naming another workspace, whatever URL carries it', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'victim.pdf',
            url: 'https://example.com/victim.pdf',
            size: 1024,
            type: 'application/pdf',
            key: `workspace/${OTHER_WORKSPACE_ID}/victim.pdf`,
            context: 'workspace',
          },
        ],
      },
    })

    expect(output.files).toBeUndefined()
  })

  /**
   * The server-side uploader for run inputs returns a *presigned cloud* URL
   * whenever object storage is configured, whose path is the bucket key rather
   * than `/api/files/serve/...`. A URL-only ownership rule therefore drops every
   * chat attachment, API `files[]` payload and webhook file field on any
   * deployment not using local storage — silently, because normalization is
   * all-or-nothing — while passing locally and under vitest, where the uploader
   * falls back to an internal URL.
   */
  it.concurrent('keeps an owned execution file carried by a presigned cloud URL', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const
    const key = `execution/${WORKSPACE_ID}/wf_1/exec_1/report.pdf`

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'report.pdf',
            url: `https://bucket.s3.us-east-1.amazonaws.com/${key}?X-Amz-Signature=abc`,
            size: 2048,
            type: 'application/pdf',
            key,
            context: 'execution',
          },
        ],
      },
    })

    expect(output.files).toEqual([
      expect.objectContaining({ id: 'file_1', key, context: 'execution' }),
    ])
  })

  /**
   * `context` selects the bucket a byte read targets, so it is derived from the
   * accepted key rather than read from the payload or the URL's `?context=`.
   * Otherwise an owned key could be labelled with a world-readable context.
   */
  it.concurrent('derives context from the key, ignoring a caller-supplied one', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const
    const key = `execution/${WORKSPACE_ID}/wf_1/exec_1/report.pdf`

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'report.pdf',
            url: `/api/files/serve/${encodeURIComponent(key)}?context=profile-pictures`,
            size: 2048,
            type: 'application/pdf',
            key,
            context: 'profile-pictures',
          },
        ],
      },
    })

    expect(output.files).toEqual([expect.objectContaining({ context: 'execution' })])
  })

  /**
   * A payload whose `key` and `url` disagree is refused rather than resolved in
   * the caller's favour. Both fields are caller-authored, so picking the one
   * that happens to pass would make a forged key free to send alongside a real
   * URL; a genuine uploader always writes the two consistently, so nothing
   * legitimate is refused.
   */
  it.concurrent('drops a file whose supplied key contradicts its internal URL', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'screenshot.png',
            url: EXECUTION_FILE_URL,
            size: 243289,
            type: 'image/png',
            key: `workspace/${OTHER_WORKSPACE_ID}/victim.pdf`,
            context: 'workspace',
          },
        ],
      },
    })

    expect(output.files).toBeUndefined()
  })

  it.concurrent('derives the storage key from an internal URL when none is supplied', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'screenshot.png',
            url: EXECUTION_FILE_URL,
            size: 243289,
            type: 'image/png',
          },
        ],
      },
    })

    expect(output.files).toEqual([
      expect.objectContaining({ id: 'file_1', name: 'screenshot.png', context: 'execution' }),
    ])
  })

  it.concurrent('rejects a malformed internal URL rather than falling back to a forged key', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'victim.pdf',
            url: '/api/files/serve/',
            size: 1024,
            type: 'application/pdf',
            key: `workspace/${OTHER_WORKSPACE_ID}/victim.pdf`,
          },
        ],
      },
    })

    expect(output.files).toBeUndefined()
  })

  it.concurrent('rejects an internal URL whose storage key names another workspace', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'victim.pdf',
            url: '/api/files/serve/s3/workspace%2Fother-tenant-ws%2Fsecrets.pdf?context=workspace',
            size: 1024,
            type: 'application/pdf',
          },
          {
            id: 'file_2',
            name: 'victim.pdf',
            url: `/api/files/serve/s3/${encodeURIComponent(`workspace/${OTHER_WORKSPACE_ID}/secrets.pdf`)}?context=workspace`,
            size: 1024,
            type: 'application/pdf',
          },
          {
            id: 'file_3',
            name: 'victim.pdf',
            url: `https://evil.example.com/api/files/serve/s3/${encodeURIComponent(
              `workspace/${OTHER_WORKSPACE_ID}/secrets.pdf`
            )}?context=workspace`,
            size: 1024,
            type: 'application/pdf',
          },
        ],
      },
    })

    expect(output.files).toBeUndefined()
  })

  it.concurrent('rejects a storage key whose layout names no workspace', () => {
    const block = createBlock('start_trigger', 'start')
    const resolution = {
      blockId: 'start',
      block,
      path: StartBlockPath.UNIFIED,
    } as const

    const output = buildStartBlockOutput({
      resolution,
      workspaceId: WORKSPACE_ID,
      workflowInput: {
        files: [
          {
            id: 'file_1',
            name: 'notes.txt',
            url: '/api/files/serve/s3/chat%2Fnotes.txt?context=chat',
            size: 12,
            type: 'text/plain',
          },
        ],
      },
    })

    expect(output.files).toBeUndefined()
  })

  it.concurrent('rejects every Start file when the execution carries no workspace', () => {
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
            url: EXECUTION_FILE_URL,
            size: 243289,
            type: 'image/png',
          },
        ],
      },
    })

    expect(output.files).toBeUndefined()
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

  describe('declared field type validation', () => {
    function unifiedResolution(inputFormat: Array<Record<string, unknown>>) {
      const block = createBlock('start_trigger', 'start', {
        subBlocks: { inputFormat: { value: inputFormat } },
      })
      return { blockId: 'start', block, path: StartBlockPath.UNIFIED } as const
    }

    it.concurrent(
      'fails the run at start when a number field receives a non-numeric string',
      () => {
        const resolution = unifiedResolution([{ name: 'count', type: 'number' }])

        expect(() =>
          buildStartBlockOutput({ resolution, workflowInput: { count: 'not-a-number' } })
        ).toThrow(StartInputValidationError)
        expect(() =>
          buildStartBlockOutput({ resolution, workflowInput: { count: 'not-a-number' } })
        ).toThrow(
          'Start block "block-start_trigger" field "count" expects a number but received "not-a-number"'
        )
        expect(() =>
          buildStartBlockOutput({ resolution, workflowInput: { count: 'Infinity' } })
        ).toThrow(StartInputValidationError)
      }
    )

    it.concurrent(
      'fails the run at start when a boolean field receives an arbitrary string',
      () => {
        const resolution = unifiedResolution([{ name: 'enabled', type: 'boolean' }])

        expect(() =>
          buildStartBlockOutput({ resolution, workflowInput: { enabled: 'yes' } })
        ).toThrow(
          'Start block "block-start_trigger" field "enabled" expects true or false but received "yes"'
        )
      }
    )

    it.concurrent(
      'still coerces well-formed strings and keeps the unset-default path lenient',
      () => {
        const resolution = unifiedResolution([
          { name: 'count', type: 'number', value: '' },
          { name: 'enabled', type: 'boolean', value: '' },
        ])

        const coerced = buildStartBlockOutput({
          resolution,
          workflowInput: { count: '42', enabled: 'false' },
        })
        expect(coerced.count).toBe(42)
        expect(coerced.enabled).toBe(false)

        expect(() => buildStartBlockOutput({ resolution, workflowInput: {} })).not.toThrow()
      }
    )

    it.concurrent('does not validate an input format the chat path never reads', () => {
      const block = createBlock('chat_trigger', 'chat', {
        subBlocks: { inputFormat: { value: [{ name: 'count', type: 'number' }] } },
      })
      const resolution = { blockId: 'chat', block, path: StartBlockPath.SPLIT_CHAT } as const

      expect(() =>
        buildStartBlockOutput({
          resolution,
          workflowInput: { input: 'hi', count: 'not-a-number' },
        })
      ).not.toThrow()
    })
  })
})
