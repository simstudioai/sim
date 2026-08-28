/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockGetBYOKKey,
  mockResolveExecutionCodexConfig,
  mockRunCloud,
  mockRunPlan,
  mockWithCodexAgentTurn,
} = vi.hoisted(() => ({
  mockGetBYOKKey: vi.fn(),
  mockResolveExecutionCodexConfig: vi.fn(),
  mockRunCloud: vi.fn(),
  mockRunPlan: vi.fn(),
  mockWithCodexAgentTurn: vi.fn(),
}))

vi.mock('@/lib/api-key/byok', () => ({ getBYOKKey: mockGetBYOKKey }))
vi.mock('@/executor/handlers/codex/cloud/authoring', () => ({ runCloudCodex: mockRunCloud }))
vi.mock('@/executor/handlers/codex/cloud/plan', () => ({ runCloudPlanCodex: mockRunPlan }))
vi.mock('@/executor/handlers/codex/core/config', () => ({
  resolveExecutionCodexConfig: mockResolveExecutionCodexConfig,
}))
vi.mock('@/executor/handlers/codex/core/session', () => ({
  parseCodexAgentId: (value: unknown, blockId: string) =>
    typeof value === 'string' && value.trim() ? value.trim() : blockId,
  withCodexAgentTurn: mockWithCodexAgentTurn,
}))
vi.mock('@/providers/cost-policy', () => ({
  calculateBillableModelCost: () => ({ input: 0, output: 0, total: 0 }),
}))

import { CodexBlockHandler } from '@/executor/handlers/codex/codex-handler'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import type { SerializedBlock } from '@/serializer/types'

const block = { id: 'codex-block', metadata: { id: 'codex' } } as unknown as SerializedBlock

function context(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    workflowId: 'workflow-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
    ...overrides,
  } as ExecutionContext
}

function totals(finalText: string) {
  return {
    finalText,
    inputTokens: 10,
    cachedInputTokens: 4,
    cacheWriteInputTokens: 1,
    outputTokens: 5,
    reasoningOutputTokens: 2,
    toolCalls: [],
    threadId: 'thread-1',
    turnCompleted: true,
  }
}

function planInputs(extra: Record<string, unknown> = {}) {
  return {
    mode: 'cloud_plan',
    task: 'Plan the change',
    model: 'gpt-5.6-sol',
    apiKey: 'sk-user',
    owner: 'simstudioai',
    repo: 'sim',
    githubToken: 'ghp-user',
    ...extra,
  }
}

describe('CodexBlockHandler', () => {
  const handler = new CodexBlockHandler()

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetBYOKKey.mockResolvedValue(null)
    mockResolveExecutionCodexConfig.mockImplementation(
      async (
        _ctx: unknown,
        options: {
          legacyStep?: Record<string, unknown>
          embeddedAgent?: Record<string, unknown>
          step?: Record<string, unknown>
        }
      ) => ({
        config: {
          mode: 'cloud_plan',
          model: 'gpt-5.6-sol',
          reasoningEffort: 'medium',
          networkAccess: false,
          ...options.legacyStep,
          ...options.embeddedAgent,
          ...options.step,
        },
        provenance: {},
      })
    )
    mockWithCodexAgentTurn.mockImplementation(
      async (_ctx, _spec, callback: (turn: Record<string, unknown>) => Promise<unknown>) =>
        callback({ session: { runner: {} }, sessionReused: false, turnNumber: 1 })
    )
    mockRunPlan.mockResolvedValue({ totals: totals('# Plan'), status: 'completed' })
    mockRunCloud.mockResolvedValue({
      totals: totals('Implemented'),
      status: 'completed',
      changedFiles: ['src/a.ts'],
      diff: 'diff',
      branch: 'codex/abc',
      prUrl: 'https://github.com/simstudioai/sim/pull/1',
    })
  })

  it('matches only the Codex block type', () => {
    expect(handler.canHandle(block)).toBe(true)
    expect(
      handler.canHandle({ id: 'other', metadata: { id: 'pi' } } as unknown as SerializedBlock)
    ).toBe(false)
  })

  it('routes Plan and returns token, thread, and status metadata', async () => {
    const output = (await handler.execute(context(), block, planInputs())) as Record<
      string,
      unknown
    >

    expect(mockRunPlan).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'cloud_plan',
        agentId: 'codex-block',
        model: 'gpt-5.6-sol',
        apiKey: 'sk-user',
        owner: 'simstudioai',
        repo: 'sim',
        githubToken: 'ghp-user',
        reasoningEffort: 'medium',
        networkAccess: false,
      }),
      expect.anything()
    )
    expect(output).toMatchObject({
      content: '# Plan',
      runStatus: 'completed',
      agentId: 'codex-block',
      sessionReused: false,
      turnNumber: 1,
      threadId: 'thread-1',
      tokens: {
        input: 10,
        cacheRead: 4,
        cacheWrite: 1,
        output: 5,
        reasoning: 2,
        total: 15,
      },
    })
    expect(output).not.toHaveProperty('changedFiles')
    expect(mockGetBYOKKey).not.toHaveBeenCalled()
  })

  it('uses a stored OpenAI BYOK key when the block key is blank', async () => {
    mockGetBYOKKey.mockResolvedValue({
      apiKey: 'sk-stored',
      isBYOK: true,
      scope: 'workspace',
    })

    await handler.execute(context(), block, planInputs({ apiKey: '' }))

    expect(mockGetBYOKKey).toHaveBeenCalledWith('workspace-1', 'openai')
    expect(mockRunPlan.mock.calls[0][0].apiKey).toBe('sk-stored')
  })

  it('never falls back to a hosted key', async () => {
    await expect(handler.execute(context(), block, planInputs({ apiKey: '' }))).rejects.toThrow(
      'Codex requires your own OpenAI API key'
    )
    expect(mockRunPlan).not.toHaveBeenCalled()
  })

  it('routes Create PR switches and authoring fields', async () => {
    const output = (await handler.execute(
      context(),
      block,
      planInputs({
        mode: 'cloud',
        task: 'Implement it',
        reasoningEffort: 'high',
        networkAccess: 'true',
        branchName: 'feature/codex',
        draft: 'false',
        prTitle: 'Codex support',
      })
    )) as Record<string, unknown>

    expect(mockRunCloud).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'cloud',
        reasoningEffort: 'high',
        networkAccess: true,
        branchName: 'feature/codex',
        draft: false,
        prTitle: 'Codex support',
      }),
      expect.anything()
    )
    expect(output).toMatchObject({
      changedFiles: ['src/a.ts'],
      branch: 'codex/abc',
      prUrl: 'https://github.com/simstudioai/sim/pull/1',
    })
  })

  it('shares a named agent instance through the execution session registry', async () => {
    await handler.execute(context(), block, planInputs({ agentId: 'reviewer' }))

    expect(mockWithCodexAgentTurn).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        agentId: 'reviewer',
        mode: 'cloud_plan',
        owner: 'simstudioai',
        repo: 'sim',
      }),
      expect.any(Function)
    )
    expect(mockRunPlan.mock.calls[0][0].agentId).toBe('reviewer')
  })

  it('uses the frozen layered configuration resolved for the selected Agent', async () => {
    mockResolveExecutionCodexConfig.mockResolvedValueOnce({
      config: {
        mode: 'cloud',
        model: 'gpt-5.5',
        owner: 'configured-owner',
        repo: 'configured-repo',
        baseBranch: 'develop',
        reasoningEffort: 'high',
        networkAccess: true,
      },
      provenance: {},
    })

    await handler.execute(
      context(),
      block,
      planInputs({
        agentId: 'reviewer',
        mode: '',
        model: '',
        owner: '',
        repo: '',
        reasoningEffort: '',
      })
    )

    expect(mockResolveExecutionCodexConfig).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ agentId: 'reviewer', legacyStep: {}, step: {} })
    )
    expect(mockRunCloud.mock.calls[0][0]).toMatchObject({
      mode: 'cloud',
      model: 'gpt-5.5',
      owner: 'configured-owner',
      repo: 'configured-repo',
      baseBranch: 'develop',
      reasoningEffort: 'high',
      networkAccess: true,
    })
  })

  it('projects resolved task secrets before the Codex model boundary', async () => {
    const registry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'secret-value', encryptedValue: 'ciphertext' },
    ])
    registry.recordResolvedAtInputPath('TOKEN', 'secret-value', ['task'])
    registry.recordResolvedInputProjection(['task'], 'Use secret-value', 'Use {{TOKEN}}')

    await handler.execute(
      context({ resolvedSecretTraceRegistry: registry }),
      block,
      planInputs({ task: 'Use secret-value' })
    )

    expect(mockRunPlan.mock.calls[0][0].task).toBe('Use {{TOKEN}}')
  })

  it('rejects invalid modes, models, and repository slugs before execution', async () => {
    await expect(handler.execute(context(), block, planInputs({ mode: 'local' }))).rejects.toThrow(
      'Invalid Codex mode'
    )
    await expect(
      handler.execute(context(), block, planInputs({ model: 'gpt-future' }))
    ).rejects.toThrow('Unsupported Codex model')
    await expect(
      handler.execute(context(), block, planInputs({ owner: 'bad/owner' }))
    ).rejects.toThrow('Invalid GitHub owner')
    expect(mockRunPlan).not.toHaveBeenCalled()
    expect(mockRunCloud).not.toHaveBeenCalled()
  })

  it('rejects a malformed hidden Agent configuration mirror', async () => {
    await expect(
      handler.execute(context(), block, planInputs({ agentConfig: '{bad json' }))
    ).rejects.toThrow('Invalid embedded Codex Agent configuration')
    expect(mockResolveExecutionCodexConfig).not.toHaveBeenCalled()
  })
})
