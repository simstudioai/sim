import { resetEnvFlagsMock, setEnvFlags } from '@sim/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExecutionContext } from '@/executor/types'
import { executeModelRequestWithFallbacks } from '@/executor/utils/model-fallback-request'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'

const { request, validateModel } = vi.hoisted(() => ({
  request: vi.fn(),
  validateModel: vi.fn(),
}))

vi.mock('@/executor/utils/provider-request', () => ({ executeBlockProviderRequest: request }))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  validateModelProvider: validateModel,
}))
vi.mock('@/providers/utils', () => ({
  getProviderFromModel: (model: string) => {
    if (model.startsWith('claude')) return 'anthropic'
    if (model.startsWith('vertex/')) return 'vertex'
    return 'openai'
  },
}))

function context(): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    blockStates: new Map(),
    blockLogs: [
      {
        blockId: 'block-1',
        startedAt: '',
        endedAt: '',
        durationMs: 0,
        success: false,
        executionOrder: 1,
      },
    ],
    metadata: { duration: 0 },
    environmentVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    loopExecutions: new Map(),
    completedLoops: new Set(),
    executedBlocks: new Set(),
    activeExecutionPath: new Set(),
  }
}

const block: SerializedBlock = {
  id: 'block-1',
  metadata: { id: 'evaluator' },
  position: { x: 0, y: 0 },
  config: { tool: 'evaluator', params: {} },
  inputs: {},
  outputs: {},
  enabled: true,
}

function input() {
  return {
    ctx: context(),
    block,
    providerId: 'openai',
    configuredModel: 'gpt-4o',
    request: {
      model: 'gpt-4o',
      apiKey: 'primary-key',
      systemPrompt: 'Score the content',
      temperature: 0.3,
    },
    fallbackSystemPrompt: 'Score the content',
    fallbackModels: [{ model: 'claude-sonnet-5' }, { model: 'gpt-4o-mini' }],
    resolvedSecretTraceRegistry: undefined,
  }
}

beforeEach(() => {
  setEnvFlags({ isHosted: false })
  request.mockReset().mockImplementation(async ({ request: candidate }) => ({
    content: '{}',
    model: candidate.model,
  }))
  validateModel.mockReset().mockResolvedValue(undefined)
})
afterEach(resetEnvFlagsMock)

describe('executeModelRequestWithFallbacks', () => {
  it('walks the chain in order, preserving the last error and recording earlier failed models', async () => {
    const options = input()
    const last = new Error('last provider failed')
    request
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(new Error('second'))
      .mockRejectedValueOnce(last)
    await expect(executeModelRequestWithFallbacks(options)).rejects.toBe(last)
    expect(request.mock.calls.map(([args]) => args.request.model)).toEqual([
      'gpt-4o',
      'claude-sonnet-5',
      'gpt-4o-mini',
    ])
    expect(options.ctx.blockLogs[0].modelFallbacks).toEqual(['gpt-4o', 'claude-sonnet-5'])
  })

  it.each([1, 2])('leaves primary attempt %i to the executor retry policy', async (attempt) => {
    const error = new Error('overloaded')
    request.mockRejectedValueOnce(error)
    await expect(
      executeModelRequestWithFallbacks({
        ...input(),
        retry: { attempt, maxTries: 3, isFinalTry: false },
      })
    ).rejects.toBe(error)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('uses fallbacks on the final primary try', async () => {
    request.mockRejectedValueOnce(new Error('overloaded'))
    expect(
      await executeModelRequestWithFallbacks({
        ...input(),
        retry: { attempt: 3, maxTries: 3, isFinalTry: true },
      })
    ).toMatchObject({ usedFallback: true, result: { model: 'claude-sonnet-5' } })
  })

  it('skips denied and incompatible provider families without sending them a request', async () => {
    request.mockRejectedValueOnce(new Error('overloaded'))
    validateModel.mockImplementation(async (_user, _workspace, model) => {
      if (model === 'claude-sonnet-5') throw new Error('not permitted')
    })
    const options = {
      ...input(),
      fallbackModels: [
        { model: 'claude-sonnet-5' },
        { model: 'vertex/gemini-3.1-pro' },
        { model: 'gpt-4o-mini' },
      ],
    }
    const output = await executeModelRequestWithFallbacks(options)
    expect(output.result.model).toBe('gpt-4o-mini')
    expect(request).toHaveBeenCalledTimes(2)
    expect(options.ctx.blockLogs[0].modelFallbacks).toEqual(['gpt-4o'])
  })

  it.each([
    Object.assign(new Error('stopped'), { name: 'AbortError' }),
    Object.assign(new Error('permanent'), { retryable: false }),
  ])('does not fall back after a non-retryable error', async (error) => {
    request.mockRejectedValueOnce(error)
    await expect(executeModelRequestWithFallbacks(input())).rejects.toBe(error)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('stops when cancelled between attempts', async () => {
    const controller = new AbortController()
    const error = new Error('provider failed during cancellation')
    request.mockImplementationOnce(async () => {
      controller.abort()
      throw error
    })
    const options = input()
    options.ctx.abortSignal = controller.signal
    await expect(executeModelRequestWithFallbacks(options)).rejects.toBe(error)
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('only sends a cross-provider key that was stored as a reference, and drops family credentials', async () => {
    const options = input()
    const rows = [{ model: 'claude-sonnet-5', apiKey: '{{ANTHROPIC_KEY}}', thinkingLevel: 'high' }]
    options.block = { ...block, config: { ...block.config, params: { fallbackModels: rows } } }
    request.mockRejectedValueOnce(new Error('overloaded'))
    await executeModelRequestWithFallbacks({
      ...options,
      request: {
        ...options.request,
        vertexProject: 'private-project',
        bedrockSecretKey: 'private-key',
        responseFormat: { name: 'scores', schema: { type: 'object' }, strict: true },
      },
      fallbackModels: [{ ...rows[0], apiKey: 'resolved-key' }],
    })
    const fallback = request.mock.calls[1][0]
    expect(fallback).toMatchObject({
      providerId: 'anthropic',
      request: {
        apiKey: 'resolved-key',
        thinkingLevel: 'high',
        temperature: 0.3,
        responseFormat: { name: 'scores' },
      },
    })
    expect(fallback.request.vertexProject).toBeUndefined()
    expect(fallback.request.bedrockSecretKey).toBeUndefined()
  })

  it.each(['raw-key', '{{MISSING_KEY}}'])(
    'does not send an unsafe or unresolved key: %s',
    async (key) => {
      const options = input()
      const rows = [{ model: 'claude-sonnet-5', apiKey: key }]
      options.block = { ...block, config: { ...block.config, params: { fallbackModels: rows } } }
      request.mockRejectedValueOnce(new Error('overloaded'))
      await executeModelRequestWithFallbacks({ ...options, fallbackModels: rows })
      expect(request.mock.calls[1][0].request.apiKey).toBeUndefined()
    }
  )

  it('uses the primary key on the same provider even if a row retained an old key', async () => {
    const options = input()
    options.block = {
      ...block,
      config: {
        ...block.config,
        params: { fallbackModels: [{ model: 'gpt-4o-mini', apiKey: '{{OLD_KEY}}' }] },
      },
    }
    request.mockRejectedValueOnce(new Error('overloaded'))
    await executeModelRequestWithFallbacks({
      ...options,
      fallbackModels: [{ model: 'gpt-4o-mini', apiKey: 'old-key' }],
    })
    expect(request.mock.calls[1][0].request.apiKey).toBe('primary-key')
  })

  it('lets hosted fallbacks resolve platform or BYOK credentials instead of a stale row key', async () => {
    setEnvFlags({ isHosted: true })
    const options = input()
    options.block = {
      ...block,
      config: {
        ...block.config,
        params: { fallbackModels: [{ model: 'claude-sonnet-5', apiKey: '{{OLD_KEY}}' }] },
      },
    }
    request.mockRejectedValueOnce(new Error('overloaded'))
    await executeModelRequestWithFallbacks({
      ...options,
      fallbackModels: [{ model: 'claude-sonnet-5', apiKey: 'old-key' }],
    })
    expect(request.mock.calls[1][0].request.apiKey).toBeUndefined()
  })

  it('strips the Auto identity prompt from fallbacks and keeps the pool model out of the trace', async () => {
    const options = input()
    request.mockRejectedValueOnce(new Error('overloaded'))
    await executeModelRequestWithFallbacks({
      ...options,
      configuredModel: 'sim-auto',
      request: { ...options.request, systemPrompt: 'Auto identity\n\nScore the content' },
    })
    expect(request.mock.calls[1][0].request.systemPrompt).toBe('Score the content')
    expect(options.ctx.blockLogs[0].modelFallbacks).toEqual(['sim-auto'])
  })
})
