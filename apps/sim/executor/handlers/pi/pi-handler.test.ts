/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRunLocal,
  mockRunCloud,
  mockRunCloudBranch,
  mockRunCloudReview,
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
  mockRunCloudBranch: vi.fn(),
  mockRunCloudReview: vi.fn(),
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
    exa: { label: 'Exa', toolId: 'exa_search' },
    serper: { label: 'Serper', toolId: 'serper_search' },
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
vi.mock('@/executor/handlers/pi/cloud-backend', () => ({
  runCloudPi: mockRunCloud,
  runCloudBranchPi: mockRunCloudBranch,
}))
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
    mockResolveSearchKey.mockReturnValue('search-key')
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
    mockRunCloudBranch.mockResolvedValue({
      totals: { finalText: 'updated', inputTokens: 0, outputTokens: 0, toolCalls: [] },
      branch: 'feature/existing',
      changedFiles: ['b.ts'],
      diff: 'branch diff',
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

  it('rejects a mode outside the three the block offers', async () => {
    await expect(
      handler.execute(ctx(), block, { mode: 'babysit', task: 'x', model: 'claude' })
    ).rejects.toThrow(/Use Create PR or Update PR with Babysit Mode enabled/)
    expect(mockResolveKey).not.toHaveBeenCalled()
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
    expect(mockRunCloudBranch).not.toHaveBeenCalled()
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
    expect(mockRunCloudBranch).not.toHaveBeenCalled()
    expect(mockRunCloudReview).not.toHaveBeenCalled()
    expect(output.prUrl).toBe('https://github.com/o/r/pull/1')
    expect(output.branch).toBe('pi/abc')
  })

  it('routes Update PR metadata to the cloud branch backend and surfaces branch output', async () => {
    const output = (await handler.execute(ctx(), block, {
      mode: 'cloud_branch',
      task: 'continue it',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
      targetBranch: 'feature/existing',
      baseBranch: 'staging',
      prTitle: 'Updated title',
      prBody: 'Updated body',
      prState: 'ready',
      skills: [{ skillId: 'skill-1' }],
      memoryType: 'conversation',
      conversationId: 'thread-1',
    })) as Record<string, unknown>

    expect(mockRunCloudBranch).toHaveBeenCalledTimes(1)
    expect(mockRunCloud).not.toHaveBeenCalled()
    expect(mockRunCloudReview).not.toHaveBeenCalled()
    expect(mockRunCloudBranch.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        mode: 'cloud_branch',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        targetBranch: 'feature/existing',
        baseBranch: 'staging',
        prTitle: 'Updated title',
        prBody: 'Updated body',
        prState: 'ready',
        skills: [],
        initialMessages: [],
      })
    )
    expect(mockResolveSkills).toHaveBeenCalled()
    expect(mockLoadMemory).toHaveBeenCalled()
    expect(mockAppendMemory).toHaveBeenCalled()
    expect(output.branch).toBe('feature/existing')
    expect(output.content).toBe('updated')
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
    expect(mockRunCloudBranch).not.toHaveBeenCalled()
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

  it('passes enabled Babysit configuration through Create PR and forces a ready PR', async () => {
    mockResolveSkills.mockResolvedValue([{ name: 'style', content: 'Be concise.' }])
    mockLoadMemory.mockResolvedValue([{ role: 'user', content: 'earlier context' }])
    mockRunCloud.mockResolvedValue({
      totals: {
        finalText: 'Create PR:\ncreated\n\nBabysit:\npartial',
        inputTokens: 2,
        outputTokens: 3,
        toolCalls: [],
      },
      memoryText: 'created',
      prUrl: 'https://github.com/o/r/pull/7',
      branch: 'pi/abc',
      rounds: 0,
      threadsClean: false,
      checksGreen: false,
      threadsResolved: 0,
      commitsPushed: 0,
      stopReason: 'awaiting_checks',
    })
    const output = (await handler.execute(ctx({ executionId: 'execution-1' }), block, {
      mode: 'cloud',
      task: 'build it',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
      babysitMode: true,
      maxRounds: '4',
      reviewMentions: '@greptile, @cursor review',
      skills: [{ skillId: 'skill-1' }],
      memoryType: 'conversation',
      conversationId: 'memory',
      draft: true,
    })) as Record<string, unknown>

    const params = mockRunCloud.mock.calls[0][0]
    expect(params).toMatchObject({
      mode: 'cloud',
      task: 'build it',
      draft: false,
      initialMessages: [{ role: 'user', content: 'earlier context' }],
      babysit: {
        maxRounds: 4,
        reviewMentions: ['@greptile', '@cursor review'],
        executionId: 'execution-1',
      },
    })
    expect(params.skills).toEqual([{ name: 'style', content: 'Be concise.' }])
    expect(mockLoadMemory).toHaveBeenCalled()
    expect(mockAppendMemory).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'build it',
      'created'
    )
    expect(output).toMatchObject({
      rounds: 0,
      threadsClean: false,
      checksGreen: false,
      threadsResolved: 0,
      commitsPushed: 0,
      stopReason: 'awaiting_checks',
    })
  })

  it('passes the same Babysit configuration through Update PR', async () => {
    mockRunCloudBranch.mockResolvedValue({
      totals: {
        finalText: 'Update PR:\nupdated\n\nBabysit:\nclean',
        inputTokens: 1,
        outputTokens: 2,
        toolCalls: [],
      },
      memoryText: 'updated',
      prUrl: 'https://github.com/o/r/pull/7',
      branch: 'feature/existing',
      rounds: 1,
      threadsClean: true,
      checksGreen: true,
      threadsResolved: 1,
      commitsPushed: 1,
      stopReason: 'clean',
    })

    const output = (await handler.execute(ctx({ executionId: 'execution-2' }), block, {
      mode: 'cloud_branch',
      task: 'continue it',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
      targetBranch: 'feature/existing',
      babysitMode: true,
      maxRounds: '5',
      reviewMentions: '@greptile, @cursor review',
      memoryType: 'conversation',
      conversationId: 'memory',
    })) as Record<string, unknown>

    expect(mockRunCloudBranch.mock.calls[0][0]).toMatchObject({
      mode: 'cloud_branch',
      targetBranch: 'feature/existing',
      babysit: {
        maxRounds: 5,
        reviewMentions: ['@greptile', '@cursor review'],
        executionId: 'execution-2',
      },
    })
    expect(mockAppendMemory).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'continue it',
      'updated'
    )
    expect(output).toMatchObject({
      prUrl: 'https://github.com/o/r/pull/7',
      rounds: 1,
      threadsClean: true,
      checksGreen: true,
      stopReason: 'clean',
    })
  })

  it.each(['cloud', 'cloud_branch'])(
    'requires reviewer mentions and bounds maxRounds in %s',
    async (mode) => {
      const inputs = {
        mode,
        task: 'build it',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        ...(mode === 'cloud_branch' ? { targetBranch: 'feature/existing' } : {}),
        babysitMode: true,
        reviewMentions: '@greptile',
      }
      await handler.execute(ctx(), block, inputs)
      const backend = mode === 'cloud' ? mockRunCloud : mockRunCloudBranch
      expect(backend.mock.calls[0][0].babysit.maxRounds).toBe(3)

      await expect(handler.execute(ctx(), block, { ...inputs, maxRounds: '11' })).rejects.toThrow(
        /at most 10/
      )
      await expect(
        handler.execute(ctx(), block, { ...inputs, reviewMentions: ' , ' })
      ).rejects.toThrow(/requires at least one reviewer mention/)
      expect(backend).toHaveBeenCalledTimes(1)
    }
  )

  it('ignores stale Babysit fields when the Create PR toggle is off', async () => {
    await handler.execute(ctx(), block, {
      mode: 'cloud',
      task: 'build it',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
      babysitMode: false,
      maxRounds: '99',
      reviewMentions: '',
      draft: true,
    })

    expect(mockRunCloud.mock.calls[0][0]).toMatchObject({ draft: true })
    expect(mockRunCloud.mock.calls[0][0]).not.toHaveProperty('babysit')
  })

  // A `switch` arrives as a string when its value came through a variable reference,
  // an API trigger payload, or a legacy serialized workflow.
  it('enables Babysit when the toggle arrives as the string "true"', async () => {
    await handler.execute(ctx(), block, {
      mode: 'cloud',
      task: 'build it',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
      babysitMode: 'true',
      reviewMentions: '@greptile',
    })

    expect(mockRunCloud.mock.calls[0][0].babysit).toMatchObject({
      reviewMentions: ['@greptile'],
    })
  })

  // The negative polarity is the one `draft` needs: it defaults on, so a strict
  // `!== false` read the string 'false' as truthy and opened a draft PR against
  // the user's explicit setting.
  it('honours a draft toggle supplied as the string "false"', async () => {
    await handler.execute(ctx(), block, {
      mode: 'cloud',
      task: 'build it',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
      babysitMode: false,
      draft: 'false',
    })

    expect(mockRunCloud.mock.calls[0][0].draft).toBe(false)
  })

  it('parses review mentions as a bounded, trimmed list', () => {
    expect(parsePiReviewMentions(' @one, , @two ')).toEqual(['@one', '@two'])
    expect(parsePiReviewMentions('')).toEqual([])
    expect(() => parsePiReviewMentions(Array.from({ length: 11 }, () => '@x').join(','))).toThrow(
      /at most 10/
    )
  })

  // Each entry becomes its own issue comment, re-posted after every pushed round, so a
  // comma inside a single mention would leave the tail on the PR once per round.
  it('rejects a mention that is really prose split on an interior comma', () => {
    expect(() => parsePiReviewMentions('@cursor review this, focusing on auth')).toThrow(
      /must start with "@" — got "focusing on auth"/
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

  it('requires a target branch in Update PR', async () => {
    await expect(
      handler.execute(ctx(), block, {
        mode: 'cloud_branch',
        task: 'x',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
      })
    ).rejects.toThrow(/Update PR requires a target branch/)
    expect(mockRunCloudBranch).not.toHaveBeenCalled()
  })

  it('rejects an invalid Update PR state before starting the backend', async () => {
    await expect(
      handler.execute(ctx(), block, {
        mode: 'cloud_branch',
        task: 'x',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        targetBranch: 'feature/existing',
        prState: 'closed',
      })
    ).rejects.toThrow(/Invalid PR state/)
    expect(mockRunCloudBranch).not.toHaveBeenCalled()
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

      // No workspaceId: there is no stored-key lookup left to scope.
      expect(mockResolveSearchKey).toHaveBeenCalledWith({
        provider: 'exa',
        apiKey: 'field-key',
      })
      expect(mockBuildSearchTool).toHaveBeenCalledWith(
        expect.anything(),
        { provider: 'exa', apiKey: 'search-key' },
        'local'
      )
      expect(mockRunLocal.mock.calls[0][0].search).toEqual({
        provider: 'exa',
        apiKey: 'search-key',
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
      })
    })

    it('passes Babysit-enabled Create PR the key without constructing a host search tool', async () => {
      mockParseSearchProvider.mockReturnValue('exa')

      await handler.execute(ctx(), block, {
        mode: 'cloud',
        task: 'build it',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        babysitMode: true,
        reviewMentions: '@greptile',
        searchProvider: 'exa',
      })

      expect(mockBuildSearchTool).not.toHaveBeenCalled()
      expect(mockRunCloud.mock.calls[0][0].search).toEqual({
        provider: 'exa',
        apiKey: 'search-key',
      })
    })

    it('passes Update PR the key without a host tool', async () => {
      mockParseSearchProvider.mockReturnValue('exa')

      await handler.execute(ctx(), block, {
        mode: 'cloud_branch',
        task: 'continue it',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
        targetBranch: 'feature/existing',
        searchProvider: 'exa',
      })

      expect(mockBuildSearchTool).not.toHaveBeenCalled()
      expect(mockRunCloudBranch.mock.calls[0][0].search).toEqual({
        provider: 'exa',
        apiKey: 'search-key',
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
      mockResolveSearchKey.mockImplementation(() => {
        throw new Error('Exa search requires your own Exa API key.')
      })

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
