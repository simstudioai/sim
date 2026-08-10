import '@sim/testing/mocks/executor'

import { loggerMock, resetEnvMock, setEnv } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BlockType } from '@/executor/constants'
import { MothershipBlockHandler } from '@/executor/handlers/mothership/mothership-handler'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'

const BILLING_ATTRIBUTION = {
  actorUserId: 'user-1',
  workspaceId: 'workspace-1',
  organizationId: 'organization-1',
  billedAccountUserId: 'owner-1',
  billingEntity: { type: 'organization', id: 'organization-1' },
  billingPeriod: {
    start: '2026-07-01T00:00:00.000Z',
    end: '2026-08-01T00:00:00.000Z',
  },
  payerSubscription: null,
} as const

const PRIVATE_PROVENANCE_TYPE = 'resolved-secret-provenance-v1'
const PRIVATE_PROVENANCE_FIELD = '__resolvedSecretTraceProvenance'
const PRIVATE_PROVENANCE = {
  version: 1,
  complete: true,
  entries: [{ name: 'API_KEY', encryptedValue: 'encrypted-secret' }],
}

const {
  mockAreModelSafeWorkspaceFileKeys,
  mockBuildAuthHeaders,
  mockBuildAPIUrl,
  mockExtractAPIErrorMessage,
  mockGenerateId,
  mockIsExecutionCancelled,
  mockIsRedisCancellationEnabled,
  mockReadUserFileContent,
} = vi.hoisted(() => ({
  mockAreModelSafeWorkspaceFileKeys: vi.fn(),
  mockBuildAuthHeaders: vi.fn(),
  mockBuildAPIUrl: vi.fn(),
  mockExtractAPIErrorMessage: vi.fn(),
  mockGenerateId: vi.fn(),
  mockIsExecutionCancelled: vi.fn(),
  mockIsRedisCancellationEnabled: vi.fn(),
  mockReadUserFileContent: vi.fn(),
}))

vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  areModelSafeWorkspaceFileKeys: mockAreModelSafeWorkspaceFileKeys,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))

vi.mock('@/executor/utils/http', () => ({
  buildAuthHeaders: mockBuildAuthHeaders,
  buildAPIUrl: mockBuildAPIUrl,
  extractAPIErrorMessage: mockExtractAPIErrorMessage,
}))

vi.mock('@sim/utils/id', () => ({
  generateId: mockGenerateId,
}))

vi.mock('@/lib/execution/cancellation', () => ({
  isExecutionCancelled: mockIsExecutionCancelled,
  isRedisCancellationEnabled: mockIsRedisCancellationEnabled,
}))

vi.mock('@/lib/execution/payloads/materialization.server', () => ({
  readUserFileContent: mockReadUserFileContent,
}))

const mockMothershipLogger = vi.mocked(loggerMock.createLogger).mock.results[
  vi
    .mocked(loggerMock.createLogger)
    .mock.calls.findIndex(([name]) => name === 'MothershipBlockHandler')
].value

function createAbortError(): Error {
  const error = new Error('The operation was aborted')
  error.name = 'AbortError'
  return error
}

function createAbortableFetchPromise(signal?: AbortSignal): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    signal?.addEventListener(
      'abort',
      () => {
        reject(createAbortError())
      },
      { once: true }
    )
  })
}

async function readStreamText(stream: ReadableStream): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
  }

  text += decoder.decode()
  reader.releaseLock()
  return text
}

function createTraceRegistryMock(): ResolvedSecretTraceRegistry & {
  importProvenanceForValue: ReturnType<typeof vi.fn>
  markIncomplete: ReturnType<typeof vi.fn>
} {
  const importedProvenance = vi.fn().mockResolvedValue(true)
  const originalMarkIncomplete: Array<() => void> = []
  const markIncomplete = vi.fn(() => {
    for (const mark of originalMarkIncomplete) mark()
  })
  const instrument = (registry: ResolvedSecretTraceRegistry): ResolvedSecretTraceRegistry => {
    const forkForInputPaths = registry.forkForInputPaths.bind(registry)
    originalMarkIncomplete.push(registry.markIncomplete.bind(registry))
    registry.importProvenanceForValue = importedProvenance
    registry.markIncomplete = markIncomplete
    registry.forkForInputPaths = ((paths, options) =>
      instrument(forkForInputPaths(paths, options))) as typeof registry.forkForInputPaths
    return registry
  }
  return instrument(new ResolvedSecretTraceRegistry()) as ResolvedSecretTraceRegistry & {
    importProvenanceForValue: ReturnType<typeof vi.fn>
    markIncomplete: ReturnType<typeof vi.fn>
  }
}

describe('MothershipBlockHandler', () => {
  let handler: MothershipBlockHandler
  let block: SerializedBlock
  let context: ExecutionContext
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    handler = new MothershipBlockHandler()
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    mockBuildAuthHeaders.mockResolvedValue({ Authorization: 'Bearer internal' })
    mockBuildAPIUrl.mockReturnValue(new URL('/api/mothership/execute', 'http://localhost:3000'))
    mockExtractAPIErrorMessage.mockResolvedValue('boom')
    mockGenerateId.mockReset()
    mockIsExecutionCancelled.mockReset()
    mockIsRedisCancellationEnabled.mockReset()
    mockIsRedisCancellationEnabled.mockReturnValue(false)
    mockReadUserFileContent.mockReset()
    mockAreModelSafeWorkspaceFileKeys.mockReset()
    mockAreModelSafeWorkspaceFileKeys.mockResolvedValue(true)
    // The handler refuses to run without the mothership credential.
    setEnv({ COPILOT_API_KEY: 'test-copilot-key' })

    block = {
      id: 'mothership-block-1',
      metadata: { id: BlockType.MOTHERSHIP, name: 'Mothership' },
      position: { x: 0, y: 0 },
      config: { tool: BlockType.MOTHERSHIP, params: {} },
      inputs: { prompt: 'string', conversationId: 'string', files: 'file[]' },
      outputs: {},
      enabled: true,
    } as SerializedBlock

    context = {
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0, billingAttribution: BILLING_ATTRIBUTION },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
      resolvedSecretTraceRegistry: createTraceRegistryMock(),
    } as ExecutionContext
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    resetEnvMock()
  })

  function createJsonResponse(payload: Record<string, unknown>, status = 200): Response {
    return new Response(
      JSON.stringify({
        ...payload,
        [PRIVATE_PROVENANCE_FIELD]: PRIVATE_PROVENANCE,
      }),
      {
        status,
        headers: {
          'Content-Type': 'application/json',
          'x-sim-private-tool-metadata': PRIVATE_PROVENANCE_TYPE,
        },
      }
    )
  }

  function createNdjsonResponse(events: unknown[], headers: Record<string, string> = {}): Response {
    const encoder = new TextEncoder()
    const enrichedEvents = events.map((event) => {
      if (!event || typeof event !== 'object' || Array.isArray(event)) return event
      const record = event as Record<string, unknown>
      if (record.type === 'error') {
        return { ...record, [PRIVATE_PROVENANCE_FIELD]: PRIVATE_PROVENANCE }
      }
      if (record.type === 'final' && record.data && typeof record.data === 'object') {
        return {
          ...record,
          data: {
            ...(record.data as Record<string, unknown>),
            [PRIVATE_PROVENANCE_FIELD]: PRIVATE_PROVENANCE,
          },
        }
      }
      return event
    })
    return new Response(
      new ReadableStream({
        start(controller) {
          for (const event of enrichedEvents) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
          }
          controller.close()
        },
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'x-sim-private-tool-metadata': PRIVATE_PROVENANCE_TYPE,
          ...headers,
        },
      }
    )
  }

  it('imports marker-gated JSON provenance without exposing it in block output', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: 'raw secret remains functional',
          toolCalls: [],
          __resolvedSecretTraceProvenance: PRIVATE_PROVENANCE,
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'x-sim-private-tool-metadata': PRIVATE_PROVENANCE_TYPE,
          },
        }
      )
    )

    const result = await handler.execute(context, block, { prompt: 'Hello' })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(options.headers).toMatchObject({
      'x-sim-request-private-tool-metadata': PRIVATE_PROVENANCE_TYPE,
    })
    expect(registry.importProvenanceForValue).toHaveBeenCalledWith(
      PRIVATE_PROVENANCE,
      expect.objectContaining({
        content: 'raw secret remains functional',
        __resolvedSecretTraceProvenance: undefined,
      }),
      { trusted: true, origin: 'mothership.payloadCrossing' }
    )
    expect(registry.markIncomplete).not.toHaveBeenCalled()
    expect(result).toMatchObject({ content: 'raw secret remains functional' })
    expect(JSON.stringify(result)).not.toContain('__resolvedSecretTraceProvenance')
    expect(JSON.stringify(result)).not.toContain('encrypted-secret')
  })

  it('projects only secrets resolved at the Mothership prompt input path', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PROMPT_SECRET', plaintext: 'prompt-secret', encryptedValue: 'prompt-ciphertext' },
      { name: 'UNUSED', plaintext: 'x', encryptedValue: 'unused-ciphertext' },
    ])
    registry.recordResolvedAtInputPath('PROMPT_SECRET', 'prompt-secret', ['prompt'])
    registry.recordResolvedInputProjection(
      ['prompt'],
      'Use prompt-secret while Box stays unchanged',
      'Use {{PROMPT_SECRET}} while Box stays unchanged'
    )
    registry.recordResolved('UNUSED', 'x')
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'done', toolCalls: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await handler.execute(context, block, {
      prompt: 'Use prompt-secret while Box stays unchanged',
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = String(options.body)
    expect(body).not.toContain('prompt-secret')
    expect(JSON.parse(body)).toMatchObject({
      messages: [{ content: 'Use {{PROMPT_SECRET}} while Box stays unchanged' }],
    })
  })

  it('does not carry a projected prompt into Mothership output provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PROMPT_SECRET', plaintext: 'x', encryptedValue: 'prompt-ciphertext' },
    ])
    registry.recordResolvedAtInputPath('PROMPT_SECRET', 'x', ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], 'Use x', 'Use {{PROMPT_SECRET}}')
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'Box', toolCalls: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const inputs = { prompt: 'Use x' }
    const result = await handler.execute(context, block, inputs)

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(options.body))).toMatchObject({
      messages: [{ content: 'Use {{PROMPT_SECRET}}' }],
    })
    expect(result).toMatchObject({ content: 'Box' })
    expect(inputs.prompt).toBe('Use x')
    expect(context.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
    expect(context.resolvedSecretTraceRegistry?.exportCommittedProvenanceForValue(result)).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
  })

  it('preserves a headerless legacy JSON response without poisoning later calls', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: 'unchanged output',
          toolCalls: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).resolves.toMatchObject({
      content: 'unchanged output',
    })

    expect(registry.importProvenanceForValue).not.toHaveBeenCalled()
    expect(registry.markIncomplete).not.toHaveBeenCalled()
  })

  it('rejects a headerless response that contains a partial private envelope', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          content: 'unchanged output',
          toolCalls: [],
          __resolvedSecretTraceProvenance: PRIVATE_PROVENANCE,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).rejects.toThrow(
      'provenance metadata is invalid'
    )

    expect(registry.importProvenanceForValue).not.toHaveBeenCalled()
    expect(registry.markIncomplete).toHaveBeenCalled()
  })

  it('poisons provenance when a declared response omits its private field', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'unsafe output', toolCalls: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-sim-private-tool-metadata': PRIVATE_PROVENANCE_TYPE,
        },
      })
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).rejects.toThrow(
      'provenance metadata is invalid'
    )

    expect(registry.importProvenanceForValue).not.toHaveBeenCalled()
    expect(registry.markIncomplete).toHaveBeenCalledOnce()
  })

  it('preserves legacy request and response behavior when no registry is available', async () => {
    context.resolvedSecretTraceRegistry = undefined
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'legacy output', toolCalls: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).resolves.toMatchObject({
      content: 'legacy output',
    })
    expect(context.resolvedSecretTraceRegistry).toBeUndefined()
  })

  it('rejects an explicitly mismatched response metadata version', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'unsafe output', toolCalls: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-sim-private-tool-metadata': 'resolved-secret-provenance-v2',
        },
      })
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).rejects.toThrow(
      'provenance metadata is invalid'
    )
    expect(registry.markIncomplete).toHaveBeenCalled()
  })

  it('preserves a headerless legacy upstream error without poisoning later calls', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'legacy upstream error' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).rejects.toThrow(
      'Sim execution failed: legacy upstream error'
    )
    expect(registry.importProvenanceForValue).not.toHaveBeenCalled()
    expect(registry.markIncomplete).not.toHaveBeenCalled()
  })

  it('keeps declared JSON error provenance separate from normal result provenance', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    mockExtractAPIErrorMessage.mockResolvedValueOnce('secret-backed failure')
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'secret-backed failure',
          __resolvedSecretTraceProvenance: PRIVATE_PROVENANCE,
        }),
        {
          status: 502,
          headers: {
            'Content-Type': 'application/json',
            'x-sim-private-tool-metadata': PRIVATE_PROVENANCE_TYPE,
          },
        }
      )
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).rejects.toThrow(
      'Sim execution failed: secret-backed failure'
    )

    expect(registry.importProvenanceForValue).toHaveBeenCalledWith(
      PRIVATE_PROVENANCE,
      expect.objectContaining({
        error: 'secret-backed failure',
        __resolvedSecretTraceProvenance: undefined,
      }),
      { trusted: true, origin: 'mothership.payloadCrossing' }
    )
    expect(context.errorResolvedSecretTraceRegistry).toBeDefined()
    expect(context.errorResolvedSecretTraceRegistry).not.toBe(context.resolvedSecretTraceRegistry)
    expect(context.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
  })

  it('imports provenance from a terminal NDJSON error without forcing structural fallback', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      createNdjsonResponse(
        [
          {
            type: 'error',
            error: 'secret-backed failure',
            __resolvedSecretTraceProvenance: PRIVATE_PROVENANCE,
          },
        ],
        { 'x-sim-private-tool-metadata': PRIVATE_PROVENANCE_TYPE }
      )
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).rejects.toThrow(
      'Sim execution failed: secret-backed failure'
    )

    expect(registry.importProvenanceForValue).toHaveBeenCalledWith(
      PRIVATE_PROVENANCE,
      expect.objectContaining({
        type: 'error',
        error: 'secret-backed failure',
        __resolvedSecretTraceProvenance: undefined,
      }),
      { trusted: true, origin: 'mothership.payloadCrossing' }
    )
    expect(registry.markIncomplete).not.toHaveBeenCalled()
    expect(context.errorResolvedSecretTraceRegistry).toBeDefined()
    expect(context.errorResolvedSecretTraceRegistry).not.toBe(context.resolvedSecretTraceRegistry)
  })

  it('imports final provenance for selected-output streaming without adding it to output', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    context.stream = true
    context.selectedOutputs = [`${block.id}_content`]
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      createNdjsonResponse(
        [
          { type: 'chunk', content: 'unchanged' },
          {
            type: 'final',
            data: {
              content: 'unchanged',
              toolCalls: [],
              __resolvedSecretTraceProvenance: PRIVATE_PROVENANCE,
            },
          },
        ],
        { 'x-sim-private-tool-metadata': PRIVATE_PROVENANCE_TYPE }
      )
    )

    const result = (await handler.execute(context, block, {
      prompt: 'Hello',
    })) as StreamingExecution

    await expect(readStreamText(result.stream)).resolves.toBe('unchanged')
    expect(registry.importProvenanceForValue).toHaveBeenCalledWith(
      PRIVATE_PROVENANCE,
      expect.objectContaining({
        content: 'unchanged',
        __resolvedSecretTraceProvenance: undefined,
      }),
      { trusted: true, origin: 'mothership.payloadCrossing' }
    )
    expect(registry.markIncomplete).not.toHaveBeenCalled()
    expect(JSON.stringify(result.execution.output)).not.toContain('__resolvedSecretTraceProvenance')
    expect(JSON.stringify(result.execution.output)).not.toContain('encrypted-secret')
  })

  it('preserves a headerless legacy NDJSON final result without poisoning later calls', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    const encoder = new TextEncoder()
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({
                  type: 'final',
                  data: { content: 'legacy final', toolCalls: [] },
                })}\n`
              )
            )
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }
      )
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).resolves.toMatchObject({
      content: 'legacy final',
    })
    expect(registry.importProvenanceForValue).not.toHaveBeenCalled()
    expect(registry.markIncomplete).not.toHaveBeenCalled()
  })

  it('preserves headerless legacy selected-output streaming without poisoning later calls', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    context.stream = true
    context.selectedOutputs = [`${block.id}_content`]
    const encoder = new TextEncoder()
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`${JSON.stringify({ type: 'chunk', content: 'legacy chunk' })}\n`)
            )
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({
                  type: 'final',
                  data: { content: 'legacy final', toolCalls: [] },
                })}\n`
              )
            )
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }
      )
    )

    const result = (await handler.execute(context, block, {
      prompt: 'Hello',
    })) as StreamingExecution
    await expect(readStreamText(result.stream)).resolves.toBe('legacy chunk')
    expect(result.execution.output).toMatchObject({ content: 'legacy final' })
    expect(registry.importProvenanceForValue).not.toHaveBeenCalled()
    expect(registry.markIncomplete).not.toHaveBeenCalled()
  })

  it('does not carry a projected prompt into streaming Mothership output provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'PROMPT_SECRET', plaintext: 'x', encryptedValue: 'prompt-ciphertext' },
    ])
    registry.recordResolvedAtInputPath('PROMPT_SECRET', 'x', ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], 'Use x', 'Use {{PROMPT_SECRET}}')
    context.resolvedSecretTraceRegistry = registry
    context.stream = true
    context.selectedOutputs = [`${block.id}_content`]
    const encoder = new TextEncoder()
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`${JSON.stringify({ type: 'chunk', content: 'Box' })}\n`)
            )
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({
                  type: 'final',
                  data: { content: 'Box', toolCalls: [] },
                })}\n`
              )
            )
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }
      )
    )

    const result = (await handler.execute(context, block, {
      prompt: 'Use x',
    })) as StreamingExecution

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(options.body))).toMatchObject({
      messages: [{ content: 'Use {{PROMPT_SECRET}}' }],
    })
    await expect(readStreamText(result.stream)).resolves.toBe('Box')
    expect(result.execution.output).toMatchObject({ content: 'Box' })
    expect(context.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
  })

  it('surfaces a headerless legacy NDJSON terminal error without poisoning later calls', async () => {
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    const encoder = new TextEncoder()
    fetchMock.mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `${JSON.stringify({ type: 'error', error: 'legacy terminal error' })}\n`
              )
            )
            controller.close()
          },
        }),
        { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } }
      )
    )

    await expect(handler.execute(context, block, { prompt: 'Hello' })).rejects.toThrow(
      'Sim execution failed: legacy terminal error'
    )
    expect(registry.importProvenanceForValue).not.toHaveBeenCalled()
    expect(registry.markIncomplete).not.toHaveBeenCalled()
  })

  it('forwards workflow and execution metadata with generated UUID ids', async () => {
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createJsonResponse({
        content: 'done',
        model: 'mothership',
        conversationId: 'chat-uuid',
        tokens: { total: 5 },
        toolCalls: [],
      })
    )

    const result = await handler.execute(context, block, { prompt: 'Hello from workflow' })

    expect(result).toEqual({
      content: 'done',
      model: 'mothership',
      conversationId: 'chat-uuid',
      tokens: { total: 5 },
      toolCalls: { list: [], count: 0 },
      cost: undefined,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:3000/api/mothership/execute')
    expect(options.method).toBe('POST')
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(options.headers).toMatchObject({
      Accept: 'application/x-ndjson',
      'X-Mothership-Execute-Stream': 'ndjson',
      'x-sim-billing-attribution': expect.any(String),
    })

    const body = JSON.parse(String(options.body))
    expect(body).toEqual({
      messages: [{ role: 'user', content: 'Hello from workflow' }],
      workspaceId: 'workspace-1',
      userId: 'user-1',
      chatId: 'chat-uuid',
      messageId: 'message-uuid',
      requestId: 'request-uuid',
      secretScope: 'all',
      mountedSecrets: [],
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
  })

  it('rejects execution before the internal request when COPILOT_API_KEY is unset', async () => {
    setEnv({ COPILOT_API_KEY: undefined })

    await expect(
      handler.execute(context, block, { prompt: 'Hello from workflow' })
    ).rejects.toThrow('COPILOT_API_KEY is not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('settles a private skill selector before reporting a missing COPILOT_API_KEY', async () => {
    setEnv({ COPILOT_API_KEY: undefined })
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SKILL_ID', plaintext: 'i', encryptedValue: 'encrypted-skill-id' },
    ])
    registry.recordResolvedAtInputPath('SKILL_ID', 'i', ['skills', '0', 'skillId'])
    registry.recordResolvedInputProjection(['skills', '0', 'skillId'], 'i', '{{SKILL_ID}}')
    context.resolvedSecretTraceRegistry = registry
    const handlerInputs = {
      prompt: 'Hello from workflow',
      skills: [{ skillId: 'i' }],
    }

    await expect(handler.execute(context, block, handlerInputs)).rejects.toThrow(
      'COPILOT_API_KEY is not configured'
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(handlerInputs.skills).toEqual([{ skillId: '{{SKILL_ID}}' }])
    expect(context.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
  })

  it('rejects execution before the internal request when billing attribution is missing', async () => {
    context.metadata.billingAttribution = undefined

    await expect(
      handler.execute(context, block, { prompt: 'Hello from workflow' })
    ).rejects.toThrow('Billing attribution is required for Mothership execution')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses a provided conversation ID as the mothership chat ID', async () => {
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createJsonResponse({
        content: 'continued',
        model: 'mothership',
        conversationId: 'existing-chat-id',
        tokens: {},
        toolCalls: [],
      })
    )

    const result = await handler.execute(context, block, {
      prompt: 'Continue this thread',
      conversationId: ' existing-chat-id ',
    })

    expect(result).toEqual({
      content: 'continued',
      model: 'mothership',
      conversationId: 'existing-chat-id',
      tokens: {},
      toolCalls: { list: [], count: 0 },
      cost: undefined,
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body).toEqual({
      messages: [{ role: 'user', content: 'Continue this thread' }],
      workspaceId: 'workspace-1',
      userId: 'user-1',
      chatId: 'existing-chat-id',
      messageId: 'message-uuid',
      requestId: 'request-uuid',
      secretScope: 'all',
      mountedSecrets: [],
      workflowId: 'workflow-1',
      executionId: 'execution-1',
    })
    expect(mockGenerateId).toHaveBeenCalledTimes(2)
  })

  it('keeps a resolved conversation ID out of logs while forwarding it unchanged', async () => {
    const conversationId = 'chat-plaintext-secret-__var_API_KEY-__sim_secret_API_KEY'
    mockGenerateId.mockReturnValueOnce('message-uuid').mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      createJsonResponse({
        content: 'continued',
        model: 'mothership',
        conversationId,
        tokens: {},
        toolCalls: [],
      })
    )

    await handler.execute(context, block, {
      prompt: 'Continue this thread',
      conversationId,
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.chatId).toBe(conversationId)

    const logged = JSON.stringify(mockMothershipLogger.info.mock.calls)
    expect(logged).not.toContain('chat-plaintext-secret')
    expect(logged).not.toContain('__var_')
    expect(logged).not.toContain('__sim_')
  })

  it('does not treat conversation IDs as secret-bearing result content', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'CONVERSATION_ID', plaintext: 'x', encryptedValue: 'encrypted-conversation-id' },
    ])
    registry.recordResolvedAtInputPath('CONVERSATION_ID', 'x', ['conversationId'])
    registry.recordResolvedInputProjection(['conversationId'], 'x', '{{CONVERSATION_ID}}')
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId.mockReturnValueOnce('message-uuid').mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'continued', toolCalls: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const inputs = {
      prompt: 'Continue this thread',
      conversationId: 'x',
    }
    const result = await handler.execute(context, block, inputs)

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(options.body)).chatId).toBe('x')
    expect(result).toMatchObject({ conversationId: 'x' })
    expect(inputs.conversationId).toBe('x')
    expect(context.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
    expect(context.resolvedSecretTraceRegistry?.exportCommittedProvenanceForValue(result)).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
  })

  it('forwards only enabled MCP tools and selected skills', async () => {
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(createJsonResponse({ content: 'done', toolCalls: [] }))

    await handler.execute(context, block, {
      prompt: 'Use my tools',
      tools: [
        {
          type: 'mcp',
          title: 'Search',
          usageControl: 'auto',
          params: {
            serverId: 'mcp-server-1',
            toolName: 'search',
            serverName: 'Docs',
            ignored: 'not-forwarded',
          },
          schema: { type: 'object', properties: { query: { type: 'string' } } },
          ignored: 'not-forwarded',
        },
        {
          type: 'mcp',
          usageControl: 'none',
          params: { serverId: 'mcp-server-1', toolName: 'disabled' },
        },
        { type: 'gmail', operation: 'gmail_send' },
      ],
      skills: [{ skillId: 'skill-1', name: 'sales-playbook' }],
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.mcpTools).toEqual([
      {
        type: 'mcp',
        usageControl: 'auto',
        schema: { type: 'object', properties: { query: { type: 'string' } } },
        params: {
          serverId: 'mcp-server-1',
          toolName: 'search',
          serverName: 'Docs',
        },
      },
    ])
    expect(body.contexts).toEqual([{ kind: 'skill', skillId: 'skill-1', label: 'sales-playbook' }])
  })

  it('does not scan arbitrary Mothership metadata, attachment names, or payloads', async () => {
    const secret = 'boundary-secret'
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'UNUSED_SECRET', plaintext: secret, encryptedValue: 'encrypted-unused-secret' },
    ])
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    const attachmentData = Buffer.from(`file contains ${secret}`, 'utf8').toString('base64')
    mockReadUserFileContent.mockResolvedValueOnce(attachmentData)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'done', toolCalls: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await handler.execute(context, block, {
      prompt: 'Use the selected context',
      files: [
        {
          name: `report-${secret}.txt`,
          key: 'workspace/workspace-1/report.txt',
          size: 32,
          type: 'text/plain',
        },
      ],
      tools: [
        {
          type: 'mcp',
          title: `Search ${secret}`,
          usageControl: 'force',
          params: {
            serverId: 'mcp-server-1',
            toolName: 'search',
            serverName: `Docs ${secret}`,
            credential: secret,
          },
          schema: {
            type: 'object',
            title: `Query ${secret}`,
            description: `Search using ${secret}`,
            properties: {
              query: { type: 'string', description: `Find ${secret}` },
            },
          },
          credential: secret,
        },
      ],
      skills: [{ skillId: 'skill-1', name: `Playbook ${secret}`, credential: secret }],
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.fileAttachments).toEqual([
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'text/plain',
          data: attachmentData,
        },
        filename: `report-${secret}.txt`,
      },
    ])
    expect(body.mcpTools).toEqual([
      {
        type: 'mcp',
        usageControl: 'force',
        schema: {
          type: 'object',
          title: `Query ${secret}`,
          description: `Search using ${secret}`,
          properties: {
            query: { type: 'string', description: `Find ${secret}` },
          },
        },
        params: {
          serverId: 'mcp-server-1',
          toolName: 'search',
          serverName: `Docs ${secret}`,
        },
      },
    ])
    expect(body.contexts).toEqual([
      { kind: 'skill', skillId: 'skill-1', label: `Playbook ${secret}` },
    ])
  })

  it('projects only resolver-recorded model-visible MCP and skill metadata', async () => {
    const secrets = [
      {
        name: 'MCP_SERVER_LABEL',
        plaintext: 'private server label',
        encryptedValue: 'encrypted-server-label',
        path: ['tools', '0', 'params', 'serverName'],
        raw: 'Docs private server label',
        projected: 'Docs {{MCP_SERVER_LABEL}}',
      },
      {
        name: 'MCP_SCHEMA_DESCRIPTION',
        plaintext: 'private schema text',
        encryptedValue: 'encrypted-schema-description',
        path: ['tools', '0', 'schema', 'description'],
        raw: 'Search private schema text for Box',
        projected: 'Search {{MCP_SCHEMA_DESCRIPTION}} for Box',
      },
      {
        name: 'SKILL_LABEL',
        plaintext: 'private skill label',
        encryptedValue: 'encrypted-skill-label',
        path: ['skills', '0', 'name'],
        raw: 'Playbook private skill label',
        projected: 'Playbook {{SKILL_LABEL}}',
      },
      {
        name: 'DISABLED_SERVER_ID',
        plaintext: 'disabled-server-secret',
        encryptedValue: 'encrypted-disabled-server-id',
        path: ['tools', '1', 'params', 'serverId'],
        raw: 'disabled-server-secret',
        projected: '{{DISABLED_SERVER_ID}}',
      },
    ] as const
    const registry = new ResolvedSecretTraceRegistry([
      ...secrets.map(({ name, plaintext, encryptedValue }) => ({
        name,
        plaintext,
        encryptedValue,
      })),
      { name: 'UNUSED_SECRET', plaintext: 'x', encryptedValue: 'encrypted-unused' },
    ])
    for (const secret of secrets) {
      registry.recordResolvedAtInputPath(secret.name, secret.plaintext, secret.path)
      registry.recordResolvedInputProjection(secret.path, secret.raw, secret.projected)
    }
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'done', toolCalls: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )
    const tools = [
      {
        type: 'mcp',
        params: {
          serverId: 'mcp-server-1',
          toolName: 'search',
          serverName: 'Docs private server label',
        },
        schema: {
          type: 'object',
          description: 'Search private schema text for Box',
          properties: { query: { type: 'string' } },
        },
      },
      {
        type: 'mcp',
        usageControl: 'none',
        params: { serverId: 'disabled-server-secret', toolName: 'disabled' },
      },
    ]
    const skills = [{ skillId: 'skill-1', name: 'Playbook private skill label' }]

    await handler.execute(context, block, {
      prompt: 'Use Box without changing it',
      tools,
      skills,
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.mcpTools).toEqual([
      {
        type: 'mcp',
        schema: {
          type: 'object',
          description: 'Search {{MCP_SCHEMA_DESCRIPTION}} for Box',
          properties: { query: { type: 'string' } },
        },
        params: {
          serverId: 'mcp-server-1',
          toolName: 'search',
          serverName: 'Docs {{MCP_SERVER_LABEL}}',
        },
      },
    ])
    expect(body.contexts).toEqual([
      { kind: 'skill', skillId: 'skill-1', label: 'Playbook {{SKILL_LABEL}}' },
    ])
    expect(JSON.stringify(body)).not.toContain('private server label')
    expect(JSON.stringify(body)).not.toContain('private schema text')
    expect(JSON.stringify(body)).not.toContain('private skill label')
    expect(tools[0].params.serverName).toBe('Docs private server label')
    expect(tools[0].schema.description).toBe('Search private schema text for Box')
    expect(skills[0].name).toBe('Playbook private skill label')
  })

  it('keeps low-entropy skill selectors private without changing lookup semantics', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FIRST_SKILL_ID', plaintext: 'x', encryptedValue: 'encrypted-first-skill-id' },
      { name: 'SECOND_SKILL_ID', plaintext: 'y', encryptedValue: 'encrypted-second-skill-id' },
    ])
    registry.recordResolvedAtInputPath('FIRST_SKILL_ID', 'x', ['skills', '0', 'skillId'])
    registry.recordResolvedInputProjection(['skills', '0', 'skillId'], 'x', '{{FIRST_SKILL_ID}}')
    registry.recordResolvedAtInputPath('SECOND_SKILL_ID', 'y', ['skills', '1', 'skillId'])
    registry.recordResolvedInputProjection(['skills', '1', 'skillId'], 'y', '{{SECOND_SKILL_ID}}')
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'Box', toolCalls: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )

    const skills = [{ skillId: 'x' }, { skillId: 'y' }]
    const handlerInputs = {
      prompt: 'Use the selected skill',
      skills,
    }

    const result = await handler.execute(context, block, handlerInputs)

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.contexts).toEqual([
      { kind: 'skill', skillId: 'x', label: 'Skill 1' },
      { kind: 'skill', skillId: 'y', label: 'Skill 2' },
    ])
    expect(handlerInputs.skills).toEqual([
      { skillId: '{{FIRST_SKILL_ID}}' },
      { skillId: '{{SECOND_SKILL_ID}}' },
    ])
    expect(result).toMatchObject({ content: 'Box' })
    expect(context.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
    expect(JSON.stringify(body.contexts)).not.toContain('FIRST_SKILL_ID')
    expect(JSON.stringify(body.contexts)).not.toContain('SECOND_SKILL_ID')
  })

  it('fails closed when a selected skill has incomplete resolver provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.recordResolvedAtInputPath('UNKNOWN_SKILL_ID', 'x', ['skills', '0', 'skillId'])
    context.resolvedSecretTraceRegistry = registry

    await expect(
      handler.execute(context, block, {
        prompt: 'Use the selected skill',
        skills: [{ skillId: 'x' }],
      })
    ).rejects.toThrow('Mothership skill selector provenance is incomplete')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('settles a private skill selector before a pre-provider failure', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'SKILL_ID', plaintext: 'x', encryptedValue: 'encrypted-skill-id' },
    ])
    registry.recordResolvedAtInputPath('SKILL_ID', 'x', ['skills', '0', 'skillId'])
    registry.recordResolvedInputProjection(['skills', '0', 'skillId'], 'x', '{{SKILL_ID}}')
    context.resolvedSecretTraceRegistry = registry
    const handlerInputs = {
      prompt: '',
      skills: [{ skillId: 'x' }],
    }

    await expect(handler.execute(context, block, handlerInputs)).rejects.toThrow(
      'Prompt input is required'
    )

    expect(fetchMock).not.toHaveBeenCalled()
    expect(handlerInputs.skills).toEqual([{ skillId: '{{SKILL_ID}}' }])
    expect(JSON.stringify(handlerInputs)).not.toContain('"x"')
    expect(context.resolvedSecretTraceRegistry?.getActiveMatches()).toEqual([])
  })

  it('preserves legacy unnamed skill labels when selectors have no resolver provenance', async () => {
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(createJsonResponse({ content: 'done', toolCalls: [] }))

    await handler.execute(context, block, {
      prompt: 'Use the selected skills',
      skills: [{ skillId: 'legacy-first' }, { skillId: 'legacy-second' }],
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.contexts).toEqual([
      { kind: 'skill', skillId: 'legacy-first', label: 'legacy-first' },
      { kind: 'skill', skillId: 'legacy-second', label: 'legacy-second' },
    ])
  })

  it('rejects only an enabled structural identifier with exact resolver provenance', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'MCP_SERVER_ID',
        plaintext: 'resolved-server-id',
        encryptedValue: 'encrypted-server-id',
      },
    ])
    registry.recordResolvedAtInputPath('MCP_SERVER_ID', 'resolved-server-id', [
      'tools',
      '0',
      'params',
      'serverId',
    ])
    registry.recordResolvedInputProjection(
      ['tools', '0', 'params', 'serverId'],
      'resolved-server-id',
      '{{MCP_SERVER_ID}}'
    )
    context.resolvedSecretTraceRegistry = registry

    await expect(
      handler.execute(context, block, {
        prompt: 'Use the selected tool',
        tools: [
          {
            type: 'mcp',
            params: { serverId: 'resolved-server-id', toolName: 'search' },
          },
        ],
      })
    ).rejects.toThrow('Mothership structural model inputs cannot contain secret references')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a resolver-derived MCP enum under a property named description', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'ENUM_VALUE',
        plaintext: 'private-option',
        encryptedValue: 'encrypted-option',
      },
    ])
    const inputPath = ['tools', '0', 'schema', 'properties', 'description', 'enum', '0'] as const
    registry.recordResolvedAtInputPath('ENUM_VALUE', 'private-option', inputPath)
    registry.recordResolvedInputProjection(inputPath, 'private-option', '{{ENUM_VALUE}}')
    context.resolvedSecretTraceRegistry = registry

    await expect(
      handler.execute(context, block, {
        prompt: 'Use the selected tool',
        tools: [
          {
            type: 'mcp',
            params: { serverId: 'server-1', toolName: 'search' },
            schema: {
              type: 'object',
              properties: {
                description: { type: 'string', enum: ['private-option'] },
              },
            },
          },
        ],
      })
    ).rejects.toThrow('Mothership structural model inputs cannot contain secret references')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('projects a resolver-recorded attachment name without changing file materialization', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'FILE_TOKEN', plaintext: 'x', encryptedValue: 'encrypted-file-token' },
    ])
    registry.recordResolvedAtInputPath('FILE_TOKEN', 'x', ['files', '0', 'name'])
    registry.recordResolvedInputProjection(
      ['files', '0', 'name'],
      'report-x.txt',
      'report-{{FILE_TOKEN}}.txt'
    )
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    const attachmentData = Buffer.from('ordinary bytes', 'utf8').toString('base64')
    mockReadUserFileContent.mockResolvedValueOnce(attachmentData)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'done', toolCalls: [] }), {
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await handler.execute(context, block, {
      prompt: 'Read the attachment',
      files: [
        {
          name: 'report-x.txt',
          key: 'workspace/workspace-1/report.txt',
          size: 32,
          type: 'text/plain',
        },
      ],
    })

    expect(mockReadUserFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'report-x.txt',
        key: 'workspace/workspace-1/report.txt',
      }),
      expect.any(Object)
    )
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.fileAttachments).toEqual([
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'text/plain',
          data: attachmentData,
        },
        filename: 'report-{{FILE_TOKEN}}.txt',
      },
    ])
  })

  it('rejects resolver-derived inline attachment bytes before materialization', async () => {
    const encodedSecret = 'aW1hZ2U='
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'FILE_BYTES',
        plaintext: encodedSecret,
        encryptedValue: 'encrypted-file-bytes',
      },
    ])
    const inputPath = ['files', '0', 'base64'] as const
    registry.recordResolvedAtInputPath('FILE_BYTES', encodedSecret, inputPath)
    registry.recordResolvedInputProjection(inputPath, encodedSecret, '{{FILE_BYTES}}')
    context.resolvedSecretTraceRegistry = registry

    await expect(
      handler.execute(context, block, {
        prompt: 'Read the attachment',
        files: [
          {
            name: 'example.png',
            key: 'workspace/workspace-1/example.png',
            size: 5,
            type: 'image/png',
            base64: encodedSecret,
          },
        ],
      })
    ).rejects.toThrow('Mothership inline file content cannot contain secret references')
    expect(mockReadUserFileContent).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects resolver-derived inline bytes inside a serialized file input', async () => {
    const rawFiles = JSON.stringify([
      {
        name: 'example.png',
        key: 'workspace/workspace-1/example.png',
        size: 5,
        type: 'image/png',
        base64: 'aW1hZ2U=',
      },
    ])
    const projectedFiles = JSON.stringify([
      {
        name: 'example.png',
        key: 'workspace/workspace-1/example.png',
        size: 5,
        type: 'image/png',
        base64: '{{FILE_BYTES}}',
      },
    ])
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'FILE_BYTES',
        plaintext: 'aW1hZ2U=',
        encryptedValue: 'encrypted-file-bytes',
      },
    ])
    registry.recordResolvedAtInputPath('FILE_BYTES', 'aW1hZ2U=', ['files'])
    registry.recordResolvedInputProjection(['files'], rawFiles, projectedFiles)
    context.resolvedSecretTraceRegistry = registry

    await expect(
      handler.execute(context, block, {
        prompt: 'Read the attachment',
        files: rawFiles,
      })
    ).rejects.toThrow('Mothership inline file content cannot contain secret references')
    expect(mockReadUserFileContent).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps dormant inline attachment bytes unchanged', async () => {
    const encodedBytes = 'aW1hZ2U='
    context.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
      {
        name: 'UNUSED_FILE_BYTES',
        plaintext: encodedBytes,
        encryptedValue: 'encrypted-unused-file-bytes',
      },
    ])
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    mockReadUserFileContent.mockResolvedValueOnce(encodedBytes)
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ content: 'done', toolCalls: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await handler.execute(context, block, {
      prompt: 'Read the attachment',
      files: [
        {
          name: 'example.png',
          key: 'workspace/workspace-1/example.png',
          size: 5,
          type: 'image/png',
          base64: encodedBytes,
        },
      ],
    })

    expect(mockReadUserFileContent).toHaveBeenCalledTimes(1)
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.fileAttachments[0].source.data).toBe(encodedBytes)
  })

  it('rejects a canonical tracked file whose exact byte provenance is not model-safe', async () => {
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    mockAreModelSafeWorkspaceFileKeys.mockResolvedValueOnce(false)

    await expect(
      handler.execute(context, block, {
        prompt: 'Read this file',
        files: [
          {
            name: 'report.txt',
            key: 'workspace/workspace-1/report.txt',
            size: 32,
            type: 'text/plain',
          },
        ],
      })
    ).rejects.toThrow('File cannot be sent to a model because its secret provenance is unavailable')
    expect(mockReadUserFileContent).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not infer secret provenance from matching protocol or schema literals', async () => {
    const secret = 'boundary-secret'
    const registry = createTraceRegistryMock()
    context.resolvedSecretTraceRegistry = registry
    mockGenerateId
      .mockReturnValueOnce('chat-uuid')
      .mockReturnValueOnce('message-uuid')
      .mockReturnValueOnce('request-uuid')
    fetchMock.mockResolvedValue(createJsonResponse({ content: 'done', toolCalls: [] }))

    await handler.execute(context, block, {
      prompt: 'Use safe selections only',
      tools: [
        {
          type: 'mcp',
          params: { serverId: secret, toolName: 'search' },
        },
        {
          type: 'mcp',
          params: { serverId: 'mcp-server-1', toolName: `search-${secret}` },
        },
        {
          type: 'mcp',
          params: { serverId: 'mcp-server-1', toolName: 'semantic-secret' },
          schema: { type: 'string', enum: [secret] },
        },
        {
          type: 'mcp',
          params: { serverId: 'mcp-server-1', toolName: 'semantic-key-secret' },
          schema: { [secret]: true },
        },
        {
          type: 'mcp',
          title: 'Safe search',
          params: { serverId: 'mcp-server-1', toolName: 'search' },
        },
      ],
      skills: [
        { skillId: secret, name: 'Unsafe' },
        { skillId: 'skill-1', name: 'Safe skill' },
      ],
    })

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.mcpTools).toHaveLength(5)
    expect(body.mcpTools[0]).toEqual({
      type: 'mcp',
      params: { serverId: secret, toolName: 'search' },
    })
    expect(body.mcpTools[2].schema).toEqual({ type: 'string', enum: [secret] })
    expect(body.contexts).toEqual([
      { kind: 'skill', skillId: secret, label: 'Unsafe' },
      { kind: 'skill', skillId: 'skill-1', label: 'Safe skill' },
    ])
  })

  it('consumes mothership execute heartbeat streams until the final result', async () => {
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createNdjsonResponse([
        { type: 'heartbeat', timestamp: '2026-05-15T18:13:48.000Z' },
        {
          type: 'final',
          data: {
            content: 'streamed done',
            model: 'mothership',
            conversationId: 'chat-uuid',
            tokens: { total: 7 },
            toolCalls: [{ name: 'tool_a', params: { a: 1 }, result: 'ok', durationMs: 42 }],
            cost: { total: 0.1 },
          },
        },
      ])
    )

    const result = await handler.execute(context, block, { prompt: 'Hello from workflow' })

    expect(result).toEqual({
      content: 'streamed done',
      model: 'mothership',
      conversationId: 'chat-uuid',
      tokens: { total: 7 },
      toolCalls: {
        list: [
          {
            name: 'tool_a',
            arguments: { a: 1 },
            result: 'ok',
            error: undefined,
            duration: 42,
          },
        ],
        count: 1,
      },
      cost: { total: 0.1 },
    })
  })

  it('preserves failed tool calls as output metadata without throwing', async () => {
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createNdjsonResponse([
        {
          type: 'final',
          data: {
            content: 'The lookup failed, so I could not use that result.',
            model: 'mothership',
            conversationId: 'chat-uuid',
            tokens: { total: 7 },
            toolCalls: [
              {
                name: 'lookup_customer',
                status: 'error',
                params: { email: 'missing@example.com' },
                result: { success: false, error: 'Customer not found' },
                error: 'Customer not found',
                durationMs: 42,
              },
            ],
          },
        },
      ])
    )

    const result = await handler.execute(context, block, { prompt: 'Hello from workflow' })

    expect(result).toEqual({
      content: 'The lookup failed, so I could not use that result.',
      model: 'mothership',
      conversationId: 'chat-uuid',
      tokens: { total: 7 },
      toolCalls: {
        list: [
          expect.objectContaining({
            name: 'lookup_customer',
            status: 'error',
            arguments: { email: 'missing@example.com' },
            result: { success: false, error: 'Customer not found' },
            error: 'Customer not found',
            duration: 42,
          }),
        ],
        count: 1,
      },
      cost: undefined,
    })
  })

  it('surfaces mothership execute stream errors', async () => {
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createNdjsonResponse([
        { type: 'heartbeat', timestamp: '2026-05-15T18:13:48.000Z' },
        { type: 'error', error: 'Mothership execution aborted' },
      ])
    )

    await expect(
      handler.execute(context, block, { prompt: 'Hello from workflow' })
    ).rejects.toThrow('Sim execution failed: Mothership execution aborted')
  })

  it('streams mothership assistant chunks and preserves final metadata', async () => {
    context.stream = true
    context.selectedOutputs = [`${block.id}_content`]
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createNdjsonResponse([
        { type: 'heartbeat', timestamp: '2026-05-15T18:13:48.000Z' },
        { type: 'chunk', content: 'Hello' },
        { type: 'heartbeat', timestamp: '2026-05-15T18:14:03.000Z' },
        { type: 'chunk', content: ' world' },
        {
          type: 'final',
          data: {
            content: 'Hello world',
            model: 'mothership',
            conversationId: 'chat-uuid',
            tokens: { total: 7 },
            toolCalls: [{ name: 'tool_a', params: { a: 1 }, result: 'ok', durationMs: 42 }],
            cost: { total: 0.1 },
          },
        },
      ])
    )

    const result = await handler.execute(context, block, { prompt: 'Hello from workflow' })
    expect(result).toHaveProperty('stream')

    const streamingExecution = result as StreamingExecution
    await expect(readStreamText(streamingExecution.stream)).resolves.toBe('Hello world')
    expect(streamingExecution.execution.output).toEqual({
      content: 'Hello world',
      model: 'mothership',
      conversationId: 'chat-uuid',
      tokens: { total: 7 },
      toolCalls: {
        list: [
          {
            name: 'tool_a',
            arguments: { a: 1 },
            result: 'ok',
            error: undefined,
            duration: 42,
          },
        ],
        count: 1,
      },
      cost: { total: 0.1 },
    })
  })

  it('surfaces mothership streaming errors while streaming selected content', async () => {
    context.stream = true
    context.selectedOutputs = [`${block.id}_content`]
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockResolvedValue(
      createNdjsonResponse([
        { type: 'chunk', content: 'partial' },
        { type: 'error', error: 'Mothership execution aborted' },
      ])
    )

    const result = (await handler.execute(context, block, {
      prompt: 'Hello from workflow',
    })) as StreamingExecution

    await expect(readStreamText(result.stream)).rejects.toThrow(
      'Sim execution failed: Mothership execution aborted'
    )
  })

  it('embeds attached files for the mothership execute request', async () => {
    const fileContent = Buffer.from('hello mothership', 'utf8').toString('base64')
    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')
    mockReadUserFileContent.mockResolvedValueOnce(fileContent)

    fetchMock.mockResolvedValue(
      createJsonResponse({
        content: 'analyzed',
        model: 'mothership',
        conversationId: 'chat-uuid',
        tokens: {},
        toolCalls: [],
      })
    )

    const result = await handler.execute(context, block, {
      prompt: 'Analyze this file',
      files: [
        {
          name: 'notes.txt',
          key: 'workspace/workspace-1/notes.txt',
          size: 16,
          type: 'text/plain',
        },
      ],
    })

    expect(result).toMatchObject({
      content: 'analyzed',
      model: 'mothership',
      conversationId: 'chat-uuid',
    })
    expect(mockReadUserFileContent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^file-/),
        key: 'workspace/workspace-1/notes.txt',
        name: 'notes.txt',
        url: '',
        size: 16,
        type: 'text/plain',
      }),
      expect.objectContaining({
        encoding: 'base64',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        requestId: 'request-uuid',
      })
    )

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(String(options.body))
    expect(body.fileAttachments).toEqual([
      {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'text/plain',
          data: fileContent,
        },
        filename: 'notes.txt',
      },
    ])
  })

  it('propagates local aborts to the mothership request', async () => {
    const abortController = new AbortController()
    context.abortSignal = abortController.signal

    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    fetchMock.mockImplementation((_url: string, options?: RequestInit) =>
      createAbortableFetchPromise(options?.signal as AbortSignal | undefined)
    )

    const executionPromise = handler.execute(context, block, { prompt: 'Abort me' })
    const abortedExecution = executionPromise.catch((error) => error)

    abortController.abort()

    await expect(abortedExecution).resolves.toMatchObject({ name: 'AbortError' })
  })

  it('propagates durable workflow cancellation to the mothership request', async () => {
    vi.useFakeTimers()

    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')
    mockIsRedisCancellationEnabled.mockReturnValue(true)
    mockIsExecutionCancelled.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

    fetchMock.mockImplementation((_url: string, options?: RequestInit) =>
      createAbortableFetchPromise(options?.signal as AbortSignal | undefined)
    )

    const executionPromise = handler.execute(context, block, { prompt: 'Cancel me durably' })
    const abortedExecution = executionPromise.catch((error) => error)

    await vi.advanceTimersByTimeAsync(1000)

    await expect(abortedExecution).resolves.toMatchObject({ name: 'AbortError' })
    expect(mockIsExecutionCancelled).toHaveBeenCalledWith('execution-1')
  })

  it('aborts the mothership request when selected-output streaming is cancelled', async () => {
    context.stream = true
    context.selectedOutputs = [`${block.id}_content`]

    mockGenerateId.mockReturnValueOnce('chat-uuid')
    mockGenerateId.mockReturnValueOnce('message-uuid')
    mockGenerateId.mockReturnValueOnce('request-uuid')

    let fetchSignal: AbortSignal | undefined
    fetchMock.mockImplementation((_url: string, options?: RequestInit) => {
      fetchSignal = options?.signal as AbortSignal | undefined
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start() {},
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/x-ndjson; charset=utf-8',
              'x-sim-private-tool-metadata': PRIVATE_PROVENANCE_TYPE,
            },
          }
        )
      )
    })

    const result = (await handler.execute(context, block, { prompt: 'Cancel stream' })) as
      | StreamingExecution
      | undefined

    await result?.stream.cancel('client_cancelled')

    expect(fetchSignal?.aborted).toBe(true)
  })
})
