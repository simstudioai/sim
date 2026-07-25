/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRunLocal,
  mockRunCloud,
  mockRunCloudReview,
  mockRunBabysit,
  mockResolveKey,
  mockResolveSkills,
  mockLoadMemory,
  mockAppendMemory,
  mockResolvePiModelId,
  mockIsPiSupportedProvider,
  mockGetProviderFromModel,
  mockParseSearchProvider,
  mockResolveSearchKey,
  mockBuildSearchTool,
  mockAssertPermissionsAllowed,
  MockToolNotAllowedError,
} = vi.hoisted(() => ({
  mockRunLocal: vi.fn(),
  mockRunCloud: vi.fn(),
  mockRunCloudReview: vi.fn(),
  mockRunBabysit: vi.fn(),
  mockResolveKey: vi.fn(),
  mockResolveSkills: vi.fn(),
  mockLoadMemory: vi.fn(),
  mockAppendMemory: vi.fn(),
  mockResolvePiModelId: vi.fn(),
  mockIsPiSupportedProvider: vi.fn(),
  mockGetProviderFromModel: vi.fn(),
  mockParseSearchProvider: vi.fn(),
  mockResolveSearchKey: vi.fn(),
  mockBuildSearchTool: vi.fn(),
  mockAssertPermissionsAllowed: vi.fn(),
  MockToolNotAllowedError: class ToolNotAllowedError extends Error {},
}))

vi.mock('@/executor/handlers/pi/keys', () => ({
  resolvePiModelKey: mockResolveKey,
  computePiCost: () => ({ input: 0, output: 0, total: 0 }),
  parsePiSearchProvider: mockParseSearchProvider,
  resolvePiSearchKey: mockResolveSearchKey,
  PI_SEARCH_PROVIDERS: {
    exa: { label: 'Exa', byokProviderId: 'exa', toolId: 'exa_search' },
    serper: { label: 'Serper', byokProviderId: 'serper', toolId: 'serper_search' },
  },
}))
vi.mock('@/executor/handlers/pi/search/tool', () => ({
  buildPiSearchToolSpec: mockBuildSearchTool,
}))
vi.mock('@/ee/access-control/utils/permission-check', () => ({
  assertPermissionsAllowed: mockAssertPermissionsAllowed,
  ToolNotAllowedError: MockToolNotAllowedError,
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
vi.mock('@/executor/handlers/pi/babysit-backend', () => ({
  runBabysitPi: mockRunBabysit,
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
    options: { integer?: boolean; min?: number; max?: number } = {}
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
    if (options.max !== undefined && parsed > options.max) {
      throw new Error(`${label} must be at most ${options.max}`)
    }
    return parsed
  },
}))

import { PiBlockHandler, parsePiReviewMentions } from '@/executor/handlers/pi/pi-handler'
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
    mockParseSearchProvider.mockReturnValue('none')
    mockResolveSearchKey.mockResolvedValue({ apiKey: 'search-key', source: 'byok' })
    mockBuildSearchTool.mockReturnValue({ name: 'web_search' })
    mockAssertPermissionsAllowed.mockResolvedValue(undefined)
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
    mockRunBabysit.mockResolvedValue({
      totals: { finalText: 'partial', inputTokens: 0, outputTokens: 0, toolCalls: [] },
      rounds: 0,
      threadsClean: false,
      checksGreen: false,
      threadsResolved: 0,
      commitsPushed: 0,
      stopReason: 'awaiting_checks',
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

  it('routes Babysit with optional task, bounded inputs, skills, and no memory', async () => {
    mockResolveSkills.mockResolvedValue([{ name: 'style', content: 'Be concise.' }])
    const output = (await handler.execute(ctx({ executionId: 'execution-1' }), block, {
      mode: 'babysit',
      task: '',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
      pullNumber: '7',
      maxRounds: '4',
      reviewMentions: '@greptile, @cursor review',
      skills: [{ skillId: 'skill-1' }],
      memoryType: 'conversation',
      conversationId: 'stale-memory',
    })) as Record<string, unknown>

    const params = mockRunBabysit.mock.calls[0][0]
    expect(params).toMatchObject({
      mode: 'babysit',
      task: '',
      pullNumber: 7,
      maxRounds: 4,
      reviewMentions: ['@greptile', '@cursor review'],
      initialMessages: [],
      executionId: 'execution-1',
    })
    expect(params.skills).toEqual([{ name: 'style', content: 'Be concise.' }])
    expect(mockLoadMemory).not.toHaveBeenCalled()
    expect(mockAppendMemory).not.toHaveBeenCalled()
    expect(output).toMatchObject({
      rounds: 0,
      threadsClean: false,
      checksGreen: false,
      threadsResolved: 0,
      commitsPushed: 0,
      stopReason: 'awaiting_checks',
    })
  })

  it('defaults maxRounds to three and rejects values above ten', async () => {
    const inputs = {
      mode: 'babysit',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
      pullNumber: '7',
    }
    await handler.execute(ctx(), block, inputs)
    expect(mockRunBabysit.mock.calls[0][0].maxRounds).toBe(3)

    await expect(handler.execute(ctx(), block, { ...inputs, maxRounds: '11' })).rejects.toThrow(
      /at most 10/
    )
  })

  it('parses review mentions as a bounded, trimmed list', () => {
    expect(parsePiReviewMentions(' one, , two ')).toEqual(['one', 'two'])
    expect(parsePiReviewMentions('')).toEqual([])
    expect(() => parsePiReviewMentions(Array.from({ length: 11 }, () => 'x').join(','))).toThrow(
      /at most 10/
    )
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

  describe('optional web search', () => {
    it('leaves search out of the backend params when the provider is None', async () => {
      await handler.execute(ctx(), block, localInputs())

      expect(mockRunLocal.mock.calls[0][0]).not.toHaveProperty('search')
      expect(mockAssertPermissionsAllowed).not.toHaveBeenCalled()
      expect(mockResolveSearchKey).not.toHaveBeenCalled()
      expect(mockBuildSearchTool).not.toHaveBeenCalled()
    })

    it('resolves the key and builds the host tool for Local Dev', async () => {
      mockParseSearchProvider.mockReturnValue('exa')

      await handler.execute(
        ctx(),
        block,
        localInputs({ searchProvider: 'exa', searchApiKey: 'field-key' })
      )

      expect(mockResolveSearchKey).toHaveBeenCalledWith({
        provider: 'exa',
        workspaceId: 'ws',
        apiKey: 'field-key',
      })
      expect(mockBuildSearchTool).toHaveBeenCalledWith(
        expect.anything(),
        { provider: 'exa', apiKey: 'search-key', keySource: 'byok' },
        'local'
      )
      expect(mockRunLocal.mock.calls[0][0].search).toEqual({
        provider: 'exa',
        apiKey: 'search-key',
        keySource: 'byok',
        tool: { name: 'web_search' },
      })
    })

    it('builds the host tool for Review Code too', async () => {
      mockParseSearchProvider.mockReturnValue('serper')

      await handler.execute(ctx(), block, {
        mode: 'cloud_review',
        task: 'review it',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        pullNumber: '7',
        searchProvider: 'serper',
      })

      expect(mockBuildSearchTool).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ provider: 'serper' }),
        'cloud_review'
      )
      expect(mockRunCloudReview.mock.calls[0][0].search.tool).toEqual({ name: 'web_search' })
    })

    it('passes Create PR the key without a host tool, which the sandbox could never call', async () => {
      mockParseSearchProvider.mockReturnValue('exa')

      await handler.execute(ctx(), block, {
        mode: 'cloud',
        task: 'do it',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        searchProvider: 'exa',
      })

      expect(mockBuildSearchTool).not.toHaveBeenCalled()
      expect(mockRunCloud.mock.calls[0][0].search).toEqual({
        provider: 'exa',
        apiKey: 'search-key',
        keySource: 'byok',
      })
    })

    it('passes Babysit the key without constructing a host search tool', async () => {
      mockParseSearchProvider.mockReturnValue('exa')

      await handler.execute(ctx(), block, {
        mode: 'babysit',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        pullNumber: '7',
        searchProvider: 'exa',
      })

      expect(mockBuildSearchTool).not.toHaveBeenCalled()
      expect(mockRunBabysit.mock.calls[0][0].search).toEqual({
        provider: 'exa',
        apiKey: 'search-key',
        keySource: 'byok',
      })
    })

    it('checks the tool denylist before touching the key', async () => {
      mockParseSearchProvider.mockReturnValue('exa')
      mockAssertPermissionsAllowed.mockRejectedValue(new MockToolNotAllowedError('denied'))

      await expect(
        handler.execute(ctx(), block, localInputs({ searchProvider: 'exa' }))
      ).rejects.toThrow(/Exa search is not allowed based on your permission group settings/)

      expect(mockAssertPermissionsAllowed).toHaveBeenCalledWith({
        userId: 'user',
        workspaceId: 'ws',
        toolId: 'exa_search',
        ctx: expect.anything(),
      })
      expect(mockResolveSearchKey).not.toHaveBeenCalled()
      expect(mockRunLocal).not.toHaveBeenCalled()
    })

    it('fails the run before a sandbox is created when the key is missing', async () => {
      mockParseSearchProvider.mockReturnValue('exa')
      mockResolveSearchKey.mockRejectedValue(new Error('Exa search requires your own Exa API key.'))

      await expect(
        handler.execute(ctx(), block, {
          mode: 'cloud',
          task: 'do it',
          model: 'claude',
          owner: 'o',
          repo: 'r',
          githubToken: 'ghp',
          searchProvider: 'exa',
        })
      ).rejects.toThrow(/requires your own Exa API key/)

      expect(mockRunCloud).not.toHaveBeenCalled()
    })
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
