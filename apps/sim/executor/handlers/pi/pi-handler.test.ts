/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRunLocal, mockRunCloud, mockRunCloudReview, mockResolveKey } = vi.hoisted(() => ({
  mockRunLocal: vi.fn(),
  mockRunCloud: vi.fn(),
  mockRunCloudReview: vi.fn(),
  mockResolveKey: vi.fn(),
}))

vi.mock('@/executor/handlers/pi/keys', () => ({
  resolvePiModelKey: mockResolveKey,
  computePiCost: () => ({ input: 0, output: 0, total: 0 }),
}))
vi.mock('@/executor/handlers/pi/context', () => ({
  resolvePiSkills: vi.fn().mockResolvedValue([]),
  loadPiMemory: vi.fn().mockResolvedValue([]),
  appendPiMemory: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/executor/handlers/pi/sim-tools', () => ({
  buildSimToolSpecs: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/executor/handlers/pi/local-backend', () => ({ runLocalPi: mockRunLocal }))
vi.mock('@/executor/handlers/pi/cloud-backend', () => ({ runCloudPi: mockRunCloud }))
vi.mock('@/executor/handlers/pi/cloud-review-backend', () => ({
  runCloudReviewPi: mockRunCloudReview,
}))
vi.mock('@/blocks/utils', () => ({
  parseOptionalNumberInput: (value: unknown) => {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
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
    mockResolveKey.mockResolvedValue({ providerId: 'anthropic', apiKey: 'k', isBYOK: true })
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

  it('routes local mode to the local backend with SSH params', async () => {
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

  it('routes cloud mode to the cloud backend and surfaces PR output', async () => {
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
    expect(output.reviewUrl).toBe('https://github.com/o/r/pull/7#pullrequestreview-1')
    expect(output.commentsPosted).toBe(2)
    expect(output.content).toBe('looks good')
  })

  it('requires SSH fields in local mode', async () => {
    await expect(
      handler.execute(ctx(), block, { mode: 'local', task: 'x', model: 'claude', host: 'h' })
    ).rejects.toThrow(/Local mode requires/)
  })

  it('requires repo + token in cloud mode', async () => {
    await expect(
      handler.execute(ctx(), block, { mode: 'cloud', task: 'x', model: 'claude', owner: 'o' })
    ).rejects.toThrow(/Cloud mode requires/)
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
    ).rejects.toThrow(/Cloud Code Review mode requires/)
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
