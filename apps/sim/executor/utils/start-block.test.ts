import { describe, expect, it } from 'vitest'
import { StartBlockPath } from '@/lib/workflows/triggers/triggers'
import type { UserFile } from '@/executor/types'
import {
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
  })

  describe('EXTERNAL_TRIGGER path', () => {
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
      subject: {
        kind: 'sim_user' as const,
        userId: 'user-1',
        email: 'real@sim.ai',
      },
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
          metadata: {
            subject: { kind: 'authenticated_email', email: 'attacker@x.com' },
          },
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
        workflowInput: {
          metadata: {
            subject: { kind: 'authenticated_email', email: 'attacker@x.com' },
          },
        },
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
  })
})
