import {
  MockToolNotAllowedError,
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRunLocal,
  mockRunCloud,
  mockRunCloudBranch,
  mockRunCloudPlan,
  mockRunCloudReview,
  mockResolveKey,
  mockResolveSkills,
  mockLoadMemory,
  mockAppendMemory,
  mockResolvePiModelId,
  mockIsPiSupportedProvider,
  mockParseSearchProvider,
  mockResolveSearchKey,
  mockBuildSearchTool,
  mockBuildSimToolSpecs,
} = vi.hoisted(() => ({
  mockRunLocal: vi.fn(),
  mockRunCloud: vi.fn(),
  mockRunCloudBranch: vi.fn(),
  mockRunCloudPlan: vi.fn(),
  mockRunCloudReview: vi.fn(),
  mockResolveKey: vi.fn(),
  mockResolveSkills: vi.fn(),
  mockLoadMemory: vi.fn(),
  mockAppendMemory: vi.fn(),
  mockResolvePiModelId: vi.fn(),
  mockIsPiSupportedProvider: vi.fn(),
  mockParseSearchProvider: vi.fn(),
  mockResolveSearchKey: vi.fn(),
  mockBuildSearchTool: vi.fn(),
  mockBuildSimToolSpecs: vi.fn(),
}))

vi.mock('@/executor/handlers/pi/core/keys', () => ({
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
vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)
vi.mock('@/executor/handlers/pi/core/context', () => ({
  resolvePiSkills: mockResolveSkills,
  loadPiMemory: mockLoadMemory,
  appendPiMemory: mockAppendMemory,
}))
vi.mock('@/executor/handlers/pi/local/sim-tools', () => ({
  buildSimToolSpecs: mockBuildSimToolSpecs,
}))
vi.mock('@/executor/handlers/pi/local/backend', () => ({ runLocalPi: mockRunLocal }))
vi.mock('@/executor/handlers/pi/cloud/authoring/backend', () => ({
  runCloudPi: mockRunCloud,
  runCloudBranchPi: mockRunCloudBranch,
}))
vi.mock('@/executor/handlers/pi/cloud/plan/backend', () => ({ runCloudPlanPi: mockRunCloudPlan }))
vi.mock('@/executor/handlers/pi/cloud/review/backend', () => ({
  runCloudReviewPi: mockRunCloudReview,
}))
vi.mock('@/providers/pi-providers', () => ({
  isPiSupportedProvider: mockIsPiSupportedProvider,
  resolvePiModelId: mockResolvePiModelId,
}))
vi.mock('@/providers/utils', () => providersUtilsMock)
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

import type { PiRunContext } from '@/executor/handlers/pi/core/backend'
import { PiBlockHandler, parsePiReviewMentions } from '@/executor/handlers/pi/pi-handler'
import type { ExecutionContext, StreamingExecution } from '@/executor/types'
import { readTrustedExecutionCost } from '@/executor/utils/errors'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'

const mockAssertPermissionsAllowed = permissionCheckMockFns.mockAssertPermissionsAllowed
const mockGetProviderFromModel = providersUtilsMockFns.mockGetProviderFromModel

const block = { id: 'blk', metadata: { id: 'pi' } } as unknown as SerializedBlock

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'wf',
    workspaceId: 'ws',
    userId: 'user',
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
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
    mockGetProviderFromModel.mockReturnValue('anthropic')
    mockIsPiSupportedProvider.mockReturnValue(true)
    mockResolvePiModelId.mockImplementation((_providerId: string, modelId: string) => modelId)
    mockResolveKey.mockResolvedValue({ apiKey: 'k', isBYOK: true })
    mockParseSearchProvider.mockReturnValue('none')
    mockResolveSearchKey.mockReturnValue('search-key')
    mockBuildSearchTool.mockReturnValue({ name: 'web_search' })
    mockAssertPermissionsAllowed.mockResolvedValue(undefined)
    mockBuildSimToolSpecs.mockResolvedValue([])
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
    mockRunCloudPlan.mockResolvedValue({
      totals: { finalText: '# Plan\nDo it', inputTokens: 3, outputTokens: 4, toolCalls: [] },
    })
    mockRunCloudReview.mockResolvedValue({
      totals: { finalText: 'looks good', inputTokens: 0, outputTokens: 0, toolCalls: [] },
      reviewUrl: 'https://github.com/o/r/pull/7#pullrequestreview-1',
      commentsPosted: 2,
    })
  })

  it('projects activated task secrets at the final Pi input boundary', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'API_KEY', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
      { name: 'UNUSED', plaintext: 'x', encryptedValue: 'unused-ciphertext' },
    ])
    registry.recordResolvedAtInputPath('API_KEY', 'secret-value', ['task'])
    registry.recordResolvedInputProjection(
      ['task'],
      'Use secret-value without changing Box.',
      'Use {{API_KEY}} without changing Box.'
    )
    registry.recordResolved('UNUSED', 'x')

    await handler.execute(
      ctx({ resolvedSecretTraceRegistry: registry }),
      block,
      localInputs({ task: 'Use secret-value without changing Box.' })
    )

    expect(mockRunLocal.mock.calls[0][0].task).toBe('Use {{API_KEY}} without changing Box.')
  })

  it('fails closed when task provenance is incomplete', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    registry.markIncomplete('unspecified')

    await expect(
      handler.execute(
        ctx({ resolvedSecretTraceRegistry: registry }),
        block,
        localInputs({ task: 'ordinary task' })
      )
    ).rejects.toThrow('Pi input could not be safely projected')
    expect(mockResolveKey).not.toHaveBeenCalled()
    expect(mockRunLocal).not.toHaveBeenCalled()
  })

  it('rejects an unavailable model before resolving credentials', async () => {
    mockResolvePiModelId.mockReturnValue(undefined)

    await expect(handler.execute(ctx(), block, localInputs())).rejects.toThrow(
      /not available.*installed Pi catalog/
    )
    expect(mockResolveKey).not.toHaveBeenCalled()
  })

  it('adds successful Function tool cost once to a non-streaming Local Dev result', async () => {
    mockBuildSimToolSpecs.mockImplementation(
      async (_ctx: unknown, _tools: unknown, functionToolCost: { total: number }) => {
        functionToolCost.total += 0.125
        return []
      }
    )

    const output = (await handler.execute(ctx(), block, localInputs())) as { cost: unknown }

    expect(output.cost).toEqual({ input: 0, output: 0, toolCost: 0.125, total: 0.125 })
  })

  it('bills the cloud sandbox a Pi session ran in, even when the model is BYOK', async () => {
    // The regression this guards: the agent's own sandbox runs on Sim's provider
    // account, so a BYOK run whose model cost is zero by definition would
    // otherwise report no cost at all for tens of minutes of paid compute.
    mockRunCloud.mockImplementation(async (_params: unknown, context: PiRunContext) => {
      if (context.sandboxCost) context.sandboxCost.total += 0.0842
      return { totals: { finalText: 'done', inputTokens: 0, outputTokens: 0 } }
    })

    const output = (await handler.execute(ctx(), block, {
      mode: 'cloud',
      task: 'do it',
      model: 'claude',
      owner: 'o',
      repo: 'r',
      githubToken: 'ghp',
    })) as { cost: unknown }

    expect(output.cost).toEqual({ input: 0, output: 0, toolCost: 0.0842, total: 0.0842 })
  })

  it('keeps the sandbox charge on a cloud session whose agent reported an error', async () => {
    // The backend returned, so the sandbox was billed and the sink holds the
    // charge — but this path throws instead of reaching buildOutput, which is
    // what would otherwise have published it.
    mockRunCloud.mockImplementation(async (_params: unknown, context: PiRunContext) => {
      if (context.sandboxCost) context.sandboxCost.total += 0.0631
      return {
        totals: { finalText: '', inputTokens: 0, outputTokens: 0, errorMessage: 'agent gave up' },
      }
    })

    const error = await handler
      .execute(ctx(), block, {
        mode: 'cloud',
        task: 'do it',
        model: 'claude',
        owner: 'o',
        repo: 'r',
        githubToken: 'ghp',
      })
      .catch((thrown: unknown) => thrown)

    expect(error).toBeInstanceOf(Error)
    // `toolCost` is absent by design: the trusted envelope validates exactly the
    // three numeric fields it will let cross the handler boundary. `total` is
    // what the ledger bills on, and it carries the sandbox charge intact.
    expect(readTrustedExecutionCost(error)).toEqual({ input: 0, output: 0, total: 0.0631 })
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

  it('parses review mentions as a bounded, trimmed list', () => {
    expect(parsePiReviewMentions(' @one, , @two ')).toEqual(['@one', '@two'])
    expect(parsePiReviewMentions('')).toEqual([])
    expect(() => parsePiReviewMentions(Array.from({ length: 11 }, () => '@x').join(','))).toThrow(
      /at most 10/
    )
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
        'local',
        'search-key'
      )
      expect(mockRunLocal.mock.calls[0][0].search).toEqual({
        provider: 'exa',
        apiKey: 'search-key',
        tool: { name: 'web_search' },
      })
    })

    it('replays search-key normalization on the resolver-recorded projection', async () => {
      mockParseSearchProvider.mockReturnValue('exa')
      mockResolveSearchKey.mockImplementation(({ apiKey }: { apiKey?: string }) => apiKey?.trim())
      const registry = new ResolvedSecretTraceRegistry([
        { name: 'SEARCH_KEY', plaintext: ' key\n', encryptedValue: 'ciphertext' },
      ])
      registry.recordResolvedAtInputPath('SEARCH_KEY', ' key\n', ['searchApiKey'])
      registry.recordResolvedInputProjection(['searchApiKey'], ' key\n', '{{SEARCH_KEY}}')

      await handler.execute(
        ctx({ resolvedSecretTraceRegistry: registry }),
        block,
        localInputs({ searchProvider: 'exa', searchApiKey: ' key\n' })
      )

      expect(mockBuildSearchTool).toHaveBeenCalledWith(
        expect.anything(),
        { provider: 'exa', apiKey: 'key' },
        'local',
        '{{SEARCH_KEY}}'
      )
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

    it('checks the tool denylist before touching the key', async () => {
      mockParseSearchProvider.mockReturnValue('exa')
      mockAssertPermissionsAllowed.mockRejectedValue(new MockToolNotAllowedError('exa_search'))

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
    mockBuildSimToolSpecs.mockImplementation(
      async (_ctx: unknown, _tools: unknown, functionToolCost: { total: number }) => {
        functionToolCost.total += 0.25
        return []
      }
    )
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
    expect(result.execution.output.cost).toEqual({
      input: 0,
      output: 0,
      toolCost: 0.25,
      total: 0.25,
    })
  })
})
