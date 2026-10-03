import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { envFlagsMockFns, resetEnvFlagsMock, setEnvFlags } from '@sim/testing/mocks/env-flags.mock'
import {
  mothershipAgentUrlMock,
  mothershipAgentUrlMockFns,
} from '@sim/testing/mocks/mothership-agent-url.mock'
import {
  mothershipGoFetchMock,
  mothershipGoFetchMockFns,
} from '@sim/testing/mocks/mothership-go-fetch.mock'
import {
  permissionCheckMock,
  permissionCheckMockFns,
} from '@sim/testing/mocks/permission-check.mock'
import { providersUtilsMock, providersUtilsMockFns } from '@sim/testing/mocks/providers-utils.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/mothership/request/go/fetch', () => mothershipGoFetchMock)
vi.mock('@/lib/mothership/server/agent-url', () => mothershipAgentUrlMock)

vi.mock('@/ee/access-control/utils/permission-check', () => permissionCheckMock)

vi.mock('@/providers/utils', () => providersUtilsMock)

import {
  type AutoRoutingSignals,
  addAutoRoutingCost,
  resolveAutoModel,
} from '@/lib/model-router/resolve'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const mockFetchGo = mothershipGoFetchMockFns.mockFetchGo
const mockGetMothershipBaseURL = mothershipAgentUrlMockFns.mockGetMothershipBaseURL

const mockGetProviderFromModel = providersUtilsMockFns.mockGetProviderFromModel
const mockValidateModelProvider = permissionCheckMockFns.mockValidateModelProvider

setEnvFlags({ isHosted: true })
envFlagsMockFns.getCostMultiplier.mockReturnValue(2)
setEnv({ COPILOT_API_KEY: 'test-copilot-key' })
afterAll(() => {
  resetEnvFlagsMock()
  resetEnvMock()
})

const ctx = {
  userId: 'user-1',
  workspaceId: 'ws-1',
  workflowId: 'wf-1',
  executionId: 'exec-1',
  resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
} as unknown as ExecutionContext

/** Distinct-by-default signals so the module-level decision cache never collides across tests. */
let signalSeq = 0
function makeSignals(overrides: Partial<AutoRoutingSignals> = {}): AutoRoutingSignals {
  return {
    systemPrompt: `analyze the quarterly report ${++signalSeq}`,
    lastMessage: 'here is the data to reconcile against the ledger',
    messageCount: 1,
    toolNames: ['exa_search'],
    mediaKind: 'none',
    hasResponseFormat: false,
    approxInputTokens: 5000,
    ...overrides,
  }
}

function routerResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: () => Promise.resolve(body) }
}

describe('addAutoRoutingCost', () => {
  it('adds a billable routing call to a settled provider cost', () => {
    expect(addAutoRoutingCost({ input: 0.001, output: 0.002, total: 0.003 }, 0.0005)).toEqual({
      input: 0.001,
      output: 0.002,
      routing: 0.0005,
      total: 0.0035,
    })
  })
})

describe('resolveAutoModel', () => {
  beforeEach(() => {
    mockGetMothershipBaseURL.mockResolvedValue('https://copilot.test')
    mockValidateModelProvider.mockResolvedValue(undefined)
    mockGetProviderFromModel.mockReturnValue('fireworks')
  })

  /** The full pool, exactly as specified: media kind → tier → model. */
  const POOL_CASES: Array<{
    mediaKind: AutoRoutingSignals['mediaKind']
    byTier: string[]
  }> = [
    {
      mediaKind: 'none',
      byTier: ['fireworks/glm-5.2', 'fireworks/glm-5.2', 'fireworks/kimi-k3'],
    },
    {
      mediaKind: 'image',
      byTier: ['gemini-3.6-flash', 'fireworks/kimi-k3', 'fireworks/kimi-k3'],
    },
    {
      mediaKind: 'file',
      byTier: ['gemini-3.6-flash', 'claude-sonnet-5', 'gpt-5.6-sol'],
    },
  ]

  for (const { mediaKind, byTier } of POOL_CASES) {
    byTier.forEach((expected, index) => {
      const tier = String(index + 1)
      it(`routes ${mediaKind} tier ${tier} to ${expected}`, async () => {
        mockFetchGo.mockResolvedValue(routerResponse({ choice: tier }))

        const result = await resolveAutoModel({
          ctx,
          blockId: 'b1',
          signals: makeSignals({ mediaKind }),
          fallbackModel: 'claude-sonnet-5',
        })

        expect(result.model).toBe(expected)
        expect(result.tier).toBe(tier)
      })
    })
  }

  it('never crosses media kinds when walking down from a denied tier', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '3' }))
    // gpt-5.6-sol denied; the file column must drop to sonnet, never to a
    // Fireworks model that cannot accept the attachment at all.
    mockValidateModelProvider.mockImplementation(async (_u, _w, model: string) => {
      if (model === 'gpt-5.6-sol') throw new Error('provider blocked')
    })

    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals({ mediaKind: 'file' }),
      fallbackModel: 'claude-sonnet-5',
    })

    expect(result.model).toBe('claude-sonnet-5')
    expect(result.tier).toBe('3')
  })

  it('uses the router choice and applies the cost multiplier when billable', async () => {
    mockFetchGo.mockResolvedValue(
      routerResponse({
        choice: '2',
        decidedBy: 'llm',
        usage: {
          model: 'glm-5.2',
          inputTokens: 900,
          cachedInputTokens: 0,
          outputTokens: 2,
          cost: 0.001,
        },
        billable: true,
      })
    )
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('fireworks/glm-5.2')
    expect(result.tier).toBe('2')
    expect(result.decidedBy).toBe('llm')
    expect(result.billableRoutingCost).toBeCloseTo(0.002)
  })

  it('does not bill when the response omits billable (fail-safe)', async () => {
    mockFetchGo.mockResolvedValue(
      routerResponse({
        choice: '1',
        usage: {
          model: 'glm-5.2',
          inputTokens: 900,
          cachedInputTokens: 0,
          outputTokens: 2,
          cost: 0.001,
        },
      })
    )
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('fireworks/glm-5.2')
    expect(result.billableRoutingCost).toBe(0)
  })

  it('falls back when the router call fails', async () => {
    mockFetchGo.mockRejectedValue(new Error('timeout'))
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('claude-sonnet-5')
    expect(result.decidedBy).toBe('fallback')
  })

  it('falls back when every pool model is denied by workspace permissions', async () => {
    mockFetchGo.mockResolvedValue(routerResponse({ choice: '1' }))
    mockValidateModelProvider.mockRejectedValue(new Error('provider blocked'))
    const result = await resolveAutoModel({
      ctx,
      blockId: 'b1',
      signals: makeSignals(),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(result.model).toBe('claude-sonnet-5')
    expect(result.decidedBy).toBe('fallback')
  })
})
