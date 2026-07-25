/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRunLocal,
  mockRunCloud,
  mockRunCloudReview,
  mockResolveKey,
  mockResolveSkills,
  mockLoadMemory,
  mockAppendMemory,
  mockResolvePiModelId,
  mockIsPiSupportedProvider,
  mockGetProviderFromModel,
} = vi.hoisted(() => ({
  mockRunLocal: vi.fn(),
  mockRunCloud: vi.fn(),
  mockRunCloudReview: vi.fn(),
  mockResolveKey: vi.fn(),
  mockResolveSkills: vi.fn(),
  mockLoadMemory: vi.fn(),
  mockAppendMemory: vi.fn(),
  mockResolvePiModelId: vi.fn(),
  mockIsPiSupportedProvider: vi.fn(),
  mockGetProviderFromModel: vi.fn(),
}))

vi.mock('@/executor/handlers/pi/keys', () => ({
  resolvePiModelKey: mockResolveKey,
  computePiCost: () => ({ input: 0, output: 0, total: 0 }),
}))
vi.mock('@/executor/handlers/pi/context', () => ({
  resolvePiSkills: mockResolveSkills,
  loadPiMemory: mockLoadMemory,
  appendPiMemory: mockAppendMemory,
}))
vi.mock('@/executor/handlers/pi/sim-tools', () => ({
  buildSimToolSpecs: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/executor/handlers/pi/local-backend', () => ({ runLocalPi: mockRunLocal }))
vi.mock('@/executor/handlers/pi/cloud-backend', () => ({ runCloudPi: mockRunCloud }))
vi.mock('@/executor/handlers/pi/cloud-review-backend', () => ({
  runCloudReviewPi: mockRunCloudReview,
}))
vi.mock('@/providers/pi-providers', () => ({
  isPiSupportedProvider: mockIsPiSupportedProvider,
  resolvePiModelId: mockResolvePiModelId,
}))
vi.mock('@/providers/utils', () => ({
  getProviderFromModel: mockGetProviderFromModel,
}))
vi.mock('@/blocks/utils', () => ({
  parseOptionalNumberInput: (
    value: unknown,
    label: string,
    options: { integer?: boolean; min?: number } = {}
  ) => {
    if (value === undefined || value === null || value === '') return undefined
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) throw new Error(`Invalid number for ${label}`)
    if (options.integer && !Number.isInteger(parsed)) {
      throw new Error(`Invalid number for ${label}: expected an integer`)
    }
    if (options.min !== undefined && parsed < options.min) {
      throw new Error(`${label} must be at least ${options.min}`)
    }
    return parsed
  },
}))

import { PiBlockHandler } from '@/executor/handlers/pi/pi-handler'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import type { SerializedBlock } from '@/serializer/types'

const block = { id: 'blk', metadata: { id: 'pi' } } as unknown as SerializedBlock

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'wf',
    workspaceId: 'ws',
    userId: 'user',
    ...overrides,
  } as ExecutionContext
}

function localInputs(extra: Record<string, unknown> = {}) {
  return {
    mode: 'local',
    task: 'do the thing',
    model: 'claude',
    host: 'box.example.com',
    username: 'deploy',
    authMethod: 'password',
    password: 'pw',
    repoPath: '/srv/repo',
    ...extra,
  }
}

describe('PiBlockHandler', () => {
  const handler = new PiBlockHandler()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetProviderFromModel.mockReturnValue('anthropic')
    mockIsPiSupportedProvider.mockReturnValue(true)
    mockResolvePiModelId.mockImplementation((_providerId: string, modelId: string) => modelId)
    mockResolveKey.mockResolvedValue({ apiKey: 'k', isBYOK: true })
    mockResolveSkills.mockResolvedValue([])
    mockLoadMemory.mockResolvedValue([])
    mockAppendMemory.mockResolvedValue(undefined)
    mockRunLocal.mockResolvedValue({
      totals: { finalText: 'hi', inputTokens: 1, outputTokens: 2, toolCalls: [] },
    })
    mockRunCloud.mockResolvedValue({
      totals: { finalText: 'done', inputTokens: 0, outputTokens: 0, toolCalls: [] },
      prUrl: 'https://github.com/o/r/pull/1',
      branch: 'pi/abc',
      changedFiles: ['a.ts'],
      diff: 'diff',
    })
    mockRunCloudReview.mockResolvedValue({
      totals: { finalText: 'looks good', inputTokens: 0, outputTokens: 0, toolCalls: [] },
      reviewUrl: 'https://github.com/o/r/pull/7#pullrequestreview-1',
      commentsPosted: 2,
    })
  })

  it('canHandle matches the pi block type', () => {
    expect(handler.canHandle(block)).toBe(true)
    expect(
      handler.canHandle({ id: 'x', metadata: { id: 'agent' } } as unknown as SerializedBlock)
    ).toBe(false)
  })

  it('throws when the task is missing', async () => {
    await expect(handler.execute(ctx(), block, { mode: 'local', task: '' })).rejects.toThrow(/Task/)
  })

  it('throws on an invalid mode', async () => {
    await expect(
      handler.execute(ctx(), block, { mode: 'spaceship', task: 'x', model: 'claude' })
    ).rejects.toThrow(/Invalid Pi mode/)
  })

  it('rejects an unavailable model before resolving credentials', async () => {
    mockResolvePiModelId.mockReturnValue(undefined)

    await expect(handler.execute(ctx(), block, localInputs())).rejects.toThrow(
      /not available.*installed Pi catalog/
    )
    expect(mockResolveKey).not.toHaveBeenCalled()
  })

  it('routes Local Dev to the local backend with SSH params', async () => {
    const output = await handler.execute(ctx(), block, localInputs())
    expect(mockRunLocal).toHaveBeenCalledTimes(1)
    expect(mockRunCloud).not.toHaveBeenCalled()
    expect(mockRunCloudReview).not.toHaveBeenCalled()
    const params = mockRunLocal.mock.calls[0][0]
    expect(params.mode).toBe('local')
    expect(params.ssh.host).toBe('box.example.com')
    expect(params.repoPath).toBe('/srv/repo')
    expect((output as Record<string, unknown>).content).toBe('hi')
  })

  it('routes Create PR to the cloud backend and surfaces PR output', async () => {
    const output = (await handler.execute(ctx(), block, {
      mode: 'cloud',
      task: 'do it',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
    })) as Record<string, unknown>
    expect(mockRunCloud).toHaveBeenCalledTimes(1)
    expect(mockRunCloudReview).not.toHaveBeenCalled()
    expect(output.prUrl).toBe('https://github.com/o/r/pull/1')
    expect(output.branch).toBe('pi/abc')
  })

  it('routes cloud_review mode and surfaces review output', async () => {
    const output = (await handler.execute(ctx(), block, {
      mode: 'cloud_review',
      task: 'review it',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
      pullNumber: '7',
      reviewEvent: 'REQUEST_CHANGES',
    })) as Record<string, unknown>

    expect(mockRunCloudReview).toHaveBeenCalledTimes(1)
    expect(mockRunCloud).not.toHaveBeenCalled()
    const params = mockRunCloudReview.mock.calls[0][0]
    expect(params.mode).toBe('cloud_review')
    expect(params.pullNumber).toBe(7)
    expect(params.reviewEvent).toBe('REQUEST_CHANGES')
    expect(params).not.toHaveProperty('skills')
    expect(params).not.toHaveProperty('initialMessages')
    expect(mockResolveSkills).not.toHaveBeenCalled()
    expect(mockLoadMemory).not.toHaveBeenCalled()
    expect(mockAppendMemory).not.toHaveBeenCalled()
    expect(output.reviewUrl).toBe('https://github.com/o/r/pull/7#pullrequestreview-1')
    expect(output.commentsPosted).toBe(2)
    expect(output.content).toBe('looks good')
  })

  it('requires SSH fields in Local Dev', async () => {
    await expect(
      handler.execute(ctx(), block, { mode: 'local', task: 'x', model: 'claude', host: 'h' })
    ).rejects.toThrow(/Local Dev requires/)
  })

  it('requires repo + token in Create PR', async () => {
    await expect(
      handler.execute(ctx(), block, { mode: 'cloud', task: 'x', model: 'claude', owner: 'o' })
    ).rejects.toThrow(/Create PR requires/)
  })

  it('requires pullNumber in cloud_review mode', async () => {
    await expect(
      handler.execute(ctx(), block, {
        mode: 'cloud_review',
        task: 'x',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
      })
    ).rejects.toThrow(/Review Code requires/)
  })

  it.each(['0', '-1', '1.5'])('rejects invalid pull request number %s', async (pullNumber) => {
    await expect(
      handler.execute(ctx(), block, {
        mode: 'cloud_review',
        task: 'x',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        pullNumber,
      })
    ).rejects.toThrow(/pullNumber/)
  })

  it('rejects autonomous approval reviews', async () => {
    await expect(
      handler.execute(ctx(), block, {
        mode: 'cloud_review',
        task: 'x',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        pullNumber: '7',
        reviewEvent: 'APPROVE',
      })
    ).rejects.toThrow(/COMMENT or REQUEST_CHANGES/)
    expect(mockRunCloudReview).not.toHaveBeenCalled()
  })

  it('streams text when the block is selected for streaming output', async () => {
    mockRunLocal.mockImplementation(async (_params, runCtx) => {
      runCtx.onEvent({ type: 'text', text: 'streamed' })
      return { totals: { finalText: 'streamed', inputTokens: 0, outputTokens: 0, toolCalls: [] } }
    })

    const result = (await handler.execute(
      ctx({ stream: true, selectedOutputs: ['blk'] }),
      block,
      localInputs()
    )) as StreamingExecution

    expect('stream' in result).toBe(true)

    const reader = result.stream.getReader()
    const decoder = new TextDecoder()
    let text = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value)
    }
    expect(text).toContain('streamed')
    expect(result.execution.output.content).toBe('streamed')
  })
})
