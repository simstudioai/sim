import {
  credentialsAccessMock,
  credentialsAccessMockFns,
} from '@sim/testing/mocks/credentials-access.mock'
import {
  llmBedrockCredentialMock,
  llmBedrockCredentialMockFns,
  MockBedrockCredentialError,
} from '@sim/testing/mocks/llm-bedrock-credential.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import '@sim/testing/mocks/executor'

import { authOAuthUtilsMock, authOAuthUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { mockResolveAutoModel } = vi.hoisted(() => ({
  mockResolveAutoModel: vi.fn(),
}))

vi.mock('@/lib/internal/llm/bedrock-credential', () => llmBedrockCredentialMock)

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)

vi.mock('@/executor/utils/credential-token', () => ({
  resolveExecutorCredentialToken: vi.fn().mockResolvedValue({ accessToken: 'mock-access-token' }),
}))

vi.mock('@/lib/credentials/access', () => credentialsAccessMock)

vi.mock('@/lib/model-router/resolve', () => ({
  addAutoRoutingCost: (cost: Record<string, number>, routingCost: number) =>
    routingCost > 0 ? { ...cost, routing: routingCost, total: cost.total + routingCost } : cost,
  resolveAutoModel: mockResolveAutoModel,
  SIM_AUTO_SYSTEM_PREAMBLE: 'Sim auto system preamble',
}))

import { BlockType } from '@/executor/constants'
import { EvaluatorBlockHandler } from '@/executor/handlers/evaluator/handler'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import type { ProviderRequest } from '@/providers/types'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'

credentialsAccessMockFns.mockGetCredentialActorContext.mockResolvedValue({
  credential: {
    id: 'test-vertex-credential-id',
    type: 'oauth',
    workspaceId: 'test-workspace',
    accountId: 'test-vertex-credential-id',
  },
  member: { role: 'admin', status: 'active' },
  hasWorkspaceAccess: true,
  canWriteWorkspace: true,
  isAdmin: true,
})

const mockCheckWorkspaceAccess = permissionsMockFns.mockCheckWorkspaceAccess
const mockResolveBedrockCredentialSession =
  llmBedrockCredentialMockFns.mockResolveBedrockCredentialSession

const mockGetProviderFromModel = getProviderFromModel as Mock
const mockExecuteProviderRequest = executeProviderRequest as Mock

/** The provider request the handler built, keyed the way the old wire body was. */
function providerRequestBody(index = 0): ProviderRequest & { provider: string } {
  const [provider, request] = mockExecuteProviderRequest.mock.calls[index] as [
    string,
    ProviderRequest,
  ]
  return { provider, ...request }
}

function providerRuntimeRegistry(index = 0): ResolvedSecretTraceRegistry | undefined {
  return mockExecuteProviderRequest.mock.calls[index][2]?.resolvedSecretTraceRegistry
}

describe('EvaluatorBlockHandler', () => {
  let handler: EvaluatorBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext

  beforeEach(() => {
    handler = new EvaluatorBlockHandler()

    mockBlock = {
      id: 'eval-block-1',
      metadata: { id: BlockType.EVALUATOR, name: 'Test Evaluator' },
      position: { x: 20, y: 20 },
      config: { tool: BlockType.EVALUATOR, params: {} },
      inputs: {
        content: 'string',
        metrics: 'json',
        model: 'string',
        temperature: 'number',
      }, // Using ParamType strings
      outputs: {},
      enabled: true,
    }

    mockContext = {
      workflowId: 'test-workflow-id',
      userId: 'test-user',
      blockStates: new Map(),
      blockLogs: [],
      metadata: { duration: 0 },
      environmentVariables: {},
      decisions: { router: new Map(), condition: new Map() },
      loopExecutions: new Map(),
      completedLoops: new Set(),
      executedBlocks: new Set(),
      activeExecutionPath: new Set(),
    }

    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })

    // Default mock implementations
    authOAuthUtilsMockFns.mockResolveOAuthAccountId.mockResolvedValue({
      accountId: 'test-vertex-credential-id',
      usedCredentialTable: false,
    })
    authOAuthUtilsMockFns.mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshed: false,
    })
    mockGetProviderFromModel.mockReturnValue('openai')
    mockResolveAutoModel.mockResolvedValue({
      model: 'fireworks/glm-5.2',
      tier: '2',
      decidedBy: 'llm',
      billableRoutingCost: 0.002,
    })

    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({ score1: 5, score2: 8 }),
      model: 'mock-model',
      tokens: { input: 50, output: 10, total: 60 },
      cost: 0.002,
      timing: { total: 200 },
    })
  })

  /**
   * The admission checks the removed `/api/providers` hop owned. Mirrors the router's
   * coverage — both handlers reach the provider through the same shared entry point.
   */
  const admissionInputs = {
    content: 'Evaluate this.',
    metrics: [{ name: 'score1', description: 'First score', range: { min: 0, max: 10 } }],
    model: 'gpt-4o',
    apiKey: 'test-api-key',
  }

  it('preserves metric scores and Auto routing cost when a fallback answers', async () => {
    mockGetProviderFromModel.mockImplementation((model: string) =>
      model.startsWith('claude') ? 'anthropic' : 'fireworks'
    )
    mockExecuteProviderRequest
      .mockRejectedValueOnce(new Error('overloaded'))
      .mockResolvedValueOnce({
        content: '{"score1":7}',
        model: 'claude-sonnet-5',
        tokens: { input: 12, output: 3, total: 15 },
        cost: { input: 0.003, output: 0.001, total: 0.004 },
      })
    const output = await handler.execute(mockContext, mockBlock, {
      ...admissionInputs,
      model: 'sim-auto',
      fallbackModels: [{ model: 'claude-sonnet-5' }],
    })
    expect(output).toMatchObject({
      content: admissionInputs.content,
      model: 'claude-sonnet-5',
      score1: 7,
      tokens: { total: 15 },
      cost: { total: 0.006 },
    })
    const first = mockExecuteProviderRequest.mock.calls[0][1]
    const fallback = mockExecuteProviderRequest.mock.calls[1][1]
    expect(fallback.responseFormat).toEqual(first.responseFormat)
    expect(fallback.systemPrompt).not.toContain('Sim auto system preamble')
    expect(fallback.apiKey).toBeUndefined()
  })

  it("signs a Bedrock evaluation with the selected AWS credential's session", async () => {
    const session = {
      credentialId: 'aws-cred',
      accessKeyId: 'ASIASESSIONKEY000001',
      secretAccessKey: 'session-secret',
      sessionToken: 'session-token',
    }
    mockGetProviderFromModel.mockReturnValue('bedrock')
    mockResolveBedrockCredentialSession.mockResolvedValueOnce(session)

    await handler.execute(mockContext, mockBlock, {
      ...admissionInputs,
      model: 'bedrock/claude',
      bedrockAuthMode: 'credential',
      bedrockCredential: 'aws-cred',
    })

    expect(mockResolveBedrockCredentialSession).toHaveBeenCalledWith(
      expect.objectContaining({ credentialId: 'aws-cred', actingUserId: 'test-user' })
    )
    expect(mockExecuteProviderRequest.mock.calls[0][1].bedrockSession).toEqual(session)
  })

  it('fails a Bedrock evaluation set to a saved AWS credential when none resolves', async () => {
    mockGetProviderFromModel.mockReturnValue('bedrock')

    await expect(
      handler.execute(mockContext, mockBlock, {
        ...admissionInputs,
        model: 'bedrock/claude',
        bedrockAuthMode: 'credential',
      })
    ).rejects.toThrow('Select an AWS credential for Bedrock')
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('keeps the AWS credential session off a fallback on another provider', async () => {
    mockGetProviderFromModel.mockImplementation((model: string) =>
      model.startsWith('claude') ? 'anthropic' : 'bedrock'
    )
    mockResolveBedrockCredentialSession.mockResolvedValueOnce({
      credentialId: 'aws-cred',
      accessKeyId: 'AKIASAVEDKEY00000001',
      secretAccessKey: 'saved-secret',
    })
    mockExecuteProviderRequest
      .mockRejectedValueOnce(new Error('overloaded'))
      .mockResolvedValueOnce({
        content: '{"score1":7}',
        model: 'claude-sonnet-5',
        tokens: { input: 12, output: 3, total: 15 },
        cost: 0,
      })

    await handler.execute(mockContext, mockBlock, {
      ...admissionInputs,
      model: 'bedrock/claude',
      bedrockAuthMode: 'credential',
      bedrockCredential: 'aws-cred',
      fallbackModels: [{ model: 'claude-sonnet-5' }],
    })

    const [fallbackProvider, fallbackRequest] = mockExecuteProviderRequest.mock.calls[1]
    expect(fallbackProvider).toBe('anthropic')
    expect(fallbackRequest.bedrockSession).toBeUndefined()
    expect(JSON.stringify(fallbackRequest)).not.toContain('saved-secret')
  })

  it('scores with a fallback model when the saved AWS credential is unavailable on the final try', async () => {
    mockGetProviderFromModel.mockImplementation((model: string) =>
      model.startsWith('claude') ? 'anthropic' : 'bedrock'
    )
    mockResolveBedrockCredentialSession.mockRejectedValueOnce(
      new MockBedrockCredentialError('AWS STS is unavailable', { reason: 'unavailable' })
    )
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: '{"score1":7}',
      model: 'claude-sonnet-5',
      tokens: { input: 12, output: 3, total: 15 },
      cost: 0,
    })
    mockContext.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry()
    mockContext.blockLogs = [
      {
        blockId: mockBlock.id,
        startedAt: '',
        endedAt: '',
        durationMs: 0,
        success: false,
        executionOrder: 1,
      },
    ]

    const output = await handler.execute(
      mockContext,
      mockBlock,
      {
        ...admissionInputs,
        model: 'bedrock/claude',
        bedrockAuthMode: 'credential',
        bedrockCredential: 'aws-cred',
        fallbackModels: [{ model: 'claude-sonnet-5' }],
      },
      { nodeId: mockBlock.id, retry: { attempt: 2, maxTries: 2, isFinalTry: true } }
    )

    expect(output).toMatchObject({ model: 'claude-sonnet-5', score1: 7 })
    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(1)
    expect(mockExecuteProviderRequest.mock.calls[0][0]).toBe('anthropic')
    expect(mockContext.blockLogs[0].modelFallbacks).toEqual(['bedrock/claude'])
  })

  it('fails a Bedrock evaluation whose AWS credential cannot be used instead of sending it', async () => {
    mockGetProviderFromModel.mockReturnValue('bedrock')
    mockResolveBedrockCredentialSession.mockRejectedValueOnce(
      new Error('Not authorized to use this AWS credential')
    )
    mockExecuteProviderRequest.mockClear()

    await expect(
      handler.execute(mockContext, mockBlock, {
        ...admissionInputs,
        model: 'bedrock/claude',
        bedrockAuthMode: 'credential',
        bedrockCredential: 'aws-cred',
      })
    ).rejects.toThrow('Not authorized to use this AWS credential')
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('refuses to reach the provider without an execution subject', async () => {
    mockContext.userId = undefined

    await expect(handler.execute(mockContext, mockBlock, admissionInputs)).rejects.toThrow(
      'Unauthorized'
    )
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('sends only model-visible evaluator provenance and excludes credentials', async () => {
    const contentSecret = 'resolved-evaluator-content'
    const metricSecret = 'resolved-evaluator-metric'
    const credentialSecret = 'resolved-evaluator-credential'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'CONTENT_SECRET',
        plaintext: contentSecret,
        encryptedValue: 'encrypted-evaluator-content',
      },
      {
        name: 'METRIC_SECRET',
        plaintext: metricSecret,
        encryptedValue: 'encrypted-evaluator-metric',
      },
      {
        name: 'API_KEY',
        plaintext: credentialSecret,
        encryptedValue: 'encrypted-evaluator-credential',
      },
    ])
    registry.recordResolvedAtInputPath('CONTENT_SECRET', contentSecret, ['content'])
    registry.recordResolvedInputProjection(['content'], contentSecret, '{{CONTENT_SECRET}}')
    registry.recordResolvedAtInputPath('METRIC_SECRET', metricSecret, [
      'metrics',
      '0',
      'description',
    ])
    registry.recordResolvedInputProjection(
      ['metrics', '0', 'description'],
      metricSecret,
      '{{METRIC_SECRET}}'
    )
    registry.recordResolved('API_KEY', credentialSecret)
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, {
      content: contentSecret,
      metrics: [
        {
          name: 'quality',
          description: metricSecret,
          range: { min: 0, max: 10 },
        },
      ],
      model: 'gpt-4o',
      apiKey: credentialSecret,
    })

    const requestBody = providerRequestBody()
    expect(providerRuntimeRegistry()?.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [
        {
          encryptedValue: 'encrypted-evaluator-content',
          name: 'CONTENT_SECRET',
        },
        {
          encryptedValue: 'encrypted-evaluator-metric',
          name: 'METRIC_SECRET',
        },
      ],
    })
    expect(requestBody.apiKey).toBe(credentialSecret)
  })

  it('projects every model-bound metric leaf and maps the score back to the raw metric name', async () => {
    const rawMetric = {
      name: 'private-metric-key',
      description: 'private metric instructions',
      range: { min: 'private minimum', max: 'private maximum' },
    }
    const projectedMetric = {
      name: '{{METRIC_NAME_SECRET}}',
      description: '{{METRIC_DESCRIPTION_SECRET}}',
      range: { min: '{{METRIC_MIN_SECRET}}', max: '{{METRIC_MAX_SECRET}}' },
    }
    const secrets = [
      {
        name: 'METRIC_NAME_SECRET',
        plaintext: rawMetric.name,
        encryptedValue: 'encrypted-metric-name',
        path: ['metrics', '0', 'name'],
        projected: projectedMetric.name,
      },
      {
        name: 'METRIC_DESCRIPTION_SECRET',
        plaintext: rawMetric.description,
        encryptedValue: 'encrypted-metric-description',
        path: ['metrics', '0', 'description'],
        projected: projectedMetric.description,
      },
      {
        name: 'METRIC_MIN_SECRET',
        plaintext: rawMetric.range.min,
        encryptedValue: 'encrypted-metric-min',
        path: ['metrics', '0', 'range', 'min'],
        projected: projectedMetric.range.min,
      },
      {
        name: 'METRIC_MAX_SECRET',
        plaintext: rawMetric.range.max,
        encryptedValue: 'encrypted-metric-max',
        path: ['metrics', '0', 'range', 'max'],
        projected: projectedMetric.range.max,
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
      registry.recordResolvedInputProjection(secret.path, secret.plaintext, secret.projected)
    }
    mockContext.resolvedSecretTraceRegistry = registry
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ [projectedMetric.name.toLowerCase()]: 7 }),
      model: 'mock-model',
      tokens: {},
      cost: 0,
    })

    const result = await handler.execute(mockContext, mockBlock, {
      content: 'Public x remains public.',
      metrics: [rawMetric],
      model: 'gpt-4o',
      apiKey: 'test-api-key',
    })

    const requestBody = providerRequestBody()
    const serializedRequest = JSON.stringify(requestBody)
    for (const secret of secrets) {
      expect(serializedRequest).not.toContain(secret.plaintext)
      expect(requestBody.systemPrompt).toContain(secret.projected)
    }
    expect(requestBody.systemPrompt).toContain('Public x remains public.')
    expect(requestBody.responseFormat.schema.properties).toEqual({
      [projectedMetric.name.toLowerCase()]: { type: 'number' },
    })
    expect(
      providerRuntimeRegistry()
        ?.exportProvenance()
        .entries.map((entry: { name: string }) => entry.name)
        .sort()
    ).toEqual(secrets.map((secret) => secret.name).sort())
    expect(result).toMatchObject({ [rawMetric.name.toLowerCase()]: 7 })
  })

  it('bills the cost the provider proxy decided rather than recomputing it', async () => {
    // The proxy already resolved key provenance and the margin; recomputing
    // here would re-charge a BYOK caller the proxy correctly zeroed.
    mockExecuteProviderRequest.mockResolvedValue({
      content: JSON.stringify({ score1: 5, score2: 8 }),
      model: 'mock-model',
      tokens: { input: 50, output: 10, total: 60 },
      cost: { input: 0.001, output: 0.0005, total: 0.0015 },
      timing: { total: 200 },
    })

    const result = await handler.execute(mockContext, mockBlock, {
      content: 'This is the content to evaluate.',
    })

    expect((result as { cost: unknown }).cost).toEqual({
      input: 0.001,
      output: 0.0005,
      total: 0.0015,
    })
  })

  it('should handle invalid/non-JSON response gracefully (scores = 0)', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [{ name: 'score', description: 'Score', range: { min: 0, max: 5 } }],
      apiKey: 'test-api-key',
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: 'Sorry, I cannot provide a score.',
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect((result as any).score).toBe(0)
  })

  it('should handle partially valid JSON response (extracts what it can)', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [
        { name: 'accuracy', description: 'Acc', range: { min: 0, max: 1 } },
        { name: 'fluency', description: 'Flu', range: { min: 0, max: 1 } },
      ],
      apiKey: 'test-api-key',
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: '{ "accuracy": 1, "fluency": invalid }',
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockContext, mockBlock, inputs)
    expect((result as any).accuracy).toBe(0)
    expect((result as any).fluency).toBe(0)
  })
})
