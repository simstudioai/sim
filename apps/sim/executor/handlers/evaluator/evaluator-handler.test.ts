import '@sim/testing/mocks/executor'

import { createLogger } from '@sim/logger'
import { authOAuthUtilsMock, authOAuthUtilsMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { mockResolveAutoModel, mockCheckWorkspaceAccess } = vi.hoisted(() => ({
  mockCheckWorkspaceAccess: vi.fn(),
  mockResolveAutoModel: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)

vi.mock('@/executor/utils/credential-token', () => ({
  fetchCredentialAccessToken: vi.fn().mockResolvedValue('mock-access-token'),
}))

vi.mock('@/lib/credentials/access', () => ({
  canUseCredential: (access: { hasWorkspaceAccess: boolean; member: unknown; isAdmin: boolean }) =>
    access.hasWorkspaceAccess && (Boolean(access.member) || access.isAdmin),
  getCredentialActorContext: vi.fn().mockResolvedValue({
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
  }),
}))

vi.mock('@/lib/model-router/resolve', () => ({
  addAutoRoutingCost: (cost: Record<string, number>, routingCost: number) =>
    routingCost > 0 ? { ...cost, routing: routingCost, total: cost.total + routingCost } : cost,
  resolveAutoModel: mockResolveAutoModel,
  SIM_AUTO_SYSTEM_PREAMBLE: 'Sim auto system preamble',
}))

import { BlockType } from '@/executor/constants'
import { EvaluatorBlockHandler } from '@/executor/handlers/evaluator/evaluator-handler'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import type { ProviderRequest } from '@/providers/types'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock } from '@/serializer/types'

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
const mockLogger =
  vi.mocked(createLogger).mock.results[
    vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'EvaluatorBlockHandler')
  ].value

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

    // Reset mocks using vi
    vi.clearAllMocks()

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

  it('should handle evaluator blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonEvalBlock: SerializedBlock = {
      ...mockBlock,
      metadata: { id: 'other' },
    }
    expect(handler.canHandle(nonEvalBlock)).toBe(false)
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

  it('refuses to reach the provider without an execution subject', async () => {
    mockContext.userId = undefined

    await expect(handler.execute(mockContext, mockBlock, admissionInputs)).rejects.toThrow(
      'Unauthorized'
    )
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('refuses to reach the provider when the subject lost workspace access', async () => {
    mockContext.workspaceId = 'test-workspace'
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: false })

    await expect(handler.execute(mockContext, mockBlock, admissionInputs)).rejects.toThrow(
      'Forbidden'
    )
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('test-workspace', 'test-user')
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('should execute evaluator block correctly with basic inputs', async () => {
    const inputs = {
      content: 'This is the content to evaluate.',
      metrics: [
        {
          name: 'score1',
          description: 'First score',
          range: { min: 0, max: 10 },
        },
        {
          name: 'score2',
          description: 'Second score',
          range: { min: 0, max: 10 },
        },
      ],
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      temperature: 0.1,
    }

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')
    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(1)

    const requestBody = providerRequestBody()
    expect(requestBody).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      systemPrompt: expect.stringContaining(inputs.content),
      responseFormat: expect.objectContaining({
        schema: {
          type: 'object',
          properties: {
            score1: { type: 'number' },
            score2: { type: 'number' },
          },
          required: ['score1', 'score2'],
          additionalProperties: false,
        },
      }),
      temperature: 0.1,
    })

    expect(result).toEqual({
      content: 'This is the content to evaluate.',
      model: 'mock-model',
      tokens: { input: 50, output: 10, total: 60 },
      cost: {
        input: 0,
        output: 0,
        total: 0,
      },
      score1: 5,
      score2: 8,
    })
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

  it('keeps the evaluator request shape when no provenance registry exists', async () => {
    await handler.execute(mockContext, mockBlock, {
      content: 'Public evaluator content',
      metrics: [{ name: 'quality', description: 'Quality', range: { min: 0, max: 10 } }],
      model: 'gpt-4o',
      apiKey: 'test-api-key',
    })

    expect(providerRuntimeRegistry()).toBeUndefined()
  })

  it('resolves sim-auto before executing evaluator and preserves its public identity', async () => {
    const inputs = {
      content: 'A clear and accurate answer.',
      metrics: [
        {
          name: 'quality',
          description: 'Overall answer quality',
          range: { min: 1, max: 5 },
        },
      ],
      model: 'sim-auto',
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ quality: 5 }),
      model: 'fireworks/glm-5.2',
      tokens: { input: 80, output: 10, total: 90 },
      cost: { input: 0.001, output: 0.0005, total: 0.0015 },
    })

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockResolveAutoModel).toHaveBeenCalledWith({
      ctx: mockContext,
      blockId: mockBlock.id,
      signals: expect.objectContaining({
        lastMessage: inputs.content,
        messageCount: 1,
        toolNames: [],
        mediaKind: 'none',
        hasResponseFormat: true,
      }),
      fallbackModel: 'claude-sonnet-5',
    })
    expect(mockGetProviderFromModel).toHaveBeenCalledWith('fireworks/glm-5.2')

    const requestBody = providerRequestBody()
    expect(requestBody).toMatchObject({
      provider: 'openai',
      model: 'fireworks/glm-5.2',
      systemPrompt: expect.stringMatching(/^Sim auto system preamble\n\n/),
    })
    expect(result).toMatchObject({
      model: 'sim-auto',
      quality: 5,
      cost: {
        input: 0.001,
        output: 0.0005,
        routing: 0.002,
        total: 0.0035,
      },
    })
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

  it('should process JSON string content correctly', async () => {
    const contentObj = { text: 'Evaluate this JSON.', value: 42 }
    const inputs = {
      content: JSON.stringify(contentObj),
      metrics: [
        {
          name: 'clarity',
          description: 'Clarity score',
          range: { min: 1, max: 5 },
        },
      ],
      apiKey: 'test-api-key',
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ clarity: 4 }),
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    await handler.execute(mockContext, mockBlock, inputs)

    const requestBody = providerRequestBody()
    expect(requestBody).toMatchObject({
      systemPrompt: expect.stringContaining(JSON.stringify(contentObj, null, 2)),
    })
  })

  it('should process object content correctly', async () => {
    const contentObj = { data: [1, 2, 3], status: 'ok' }
    const inputs = {
      content: contentObj,
      metrics: [
        {
          name: 'completeness',
          description: 'Data completeness',
          range: { min: 0, max: 1 },
        },
      ],
      apiKey: 'test-api-key',
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ completeness: 1 }),
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    await handler.execute(mockContext, mockBlock, inputs)

    const requestBody = providerRequestBody()
    expect(requestBody).toMatchObject({
      systemPrompt: expect.stringContaining(JSON.stringify(contentObj, null, 2)),
    })
  })

  it('should parse valid JSON response correctly', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [
        {
          name: 'quality',
          description: 'Quality score',
          range: { min: 1, max: 10 },
        },
      ],
      apiKey: 'test-api-key',
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: '```json\n{ "quality": 9 }\n```',
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect((result as any).quality).toBe(9)
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

  it('should extract metric scores ignoring case', async () => {
    const inputs = {
      content: 'Test',
      metrics: [
        {
          name: 'CamelCaseScore',
          description: 'Desc',
          range: { min: 0, max: 10 },
        },
      ],
      apiKey: 'test-api-key',
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ camelcasescore: 7 }),
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect((result as any).camelcasescore).toBe(7)
  })

  it('should handle missing metrics in response (score = 0)', async () => {
    const inputs = {
      content: 'Test',
      metrics: [
        {
          name: 'presentScore',
          description: 'Desc1',
          range: { min: 0, max: 5 },
        },
        {
          name: 'missingScore',
          description: 'Desc2',
          range: { min: 0, max: 5 },
        },
      ],
      apiKey: 'test-api-key',
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ presentScore: 4 }),
      model: 'm',
      tokens: {},
      cost: 0,
      timing: {},
    })

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect((result as any).presentscore).toBe(4)
    expect((result as any).missingscore).toBe(0)
  })

  it('should handle server error responses', async () => {
    const inputs = { content: 'Test error handling.', apiKey: 'test-api-key' }

    // Override fetch mock to return an error
    mockExecuteProviderRequest.mockRejectedValueOnce(new Error('Server error'))

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow('Server error')
  })

  it('projects evaluator failures before logging without changing the thrown error', async () => {
    const providerError = 'provider echoed resolved-evaluator-secret __var_CONTENT_SECRET'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'CONTENT_SECRET',
        plaintext: 'resolved-evaluator-secret',
        encryptedValue: 'encrypted-evaluator-secret',
      },
    ])
    registry.recordResolved('CONTENT_SECRET', 'resolved-evaluator-secret')
    mockContext.resolvedSecretTraceRegistry = registry
    mockExecuteProviderRequest.mockRejectedValueOnce(new Error(providerError))

    await expect(
      handler.execute(mockContext, mockBlock, {
        content: 'resolved-evaluator-secret',
        metrics: [],
      })
    ).rejects.toThrow(providerError)

    const logged = JSON.stringify(mockLogger.error.mock.calls)
    expect(logged).not.toContain('resolved-evaluator-secret')
    expect(logged).not.toContain('__var_')
    expect(logged).toContain('{{CONTENT_SECRET}}')
  })

  it('should handle Azure OpenAI models with endpoint and API version', async () => {
    const inputs = {
      content: 'Test content to evaluate',
      metrics: [
        {
          name: 'quality',
          description: 'Quality score',
          range: { min: 1, max: 10 },
        },
      ],
      model: 'gpt-4o',
      apiKey: 'test-azure-key',
      azureEndpoint: 'https://test.openai.azure.com',
      azureApiVersion: '2024-07-01-preview',
    }

    mockGetProviderFromModel.mockReturnValue('azure-openai')

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ quality: 8 }),
      model: 'gpt-4o',
      tokens: {},
      cost: 0,
      timing: {},
    })

    await handler.execute(mockContext, mockBlock, inputs)

    const requestBody = providerRequestBody()

    expect(requestBody).toMatchObject({
      provider: 'azure-openai',
      model: 'gpt-4o',
      apiKey: 'test-azure-key',
      azureEndpoint: 'https://test.openai.azure.com',
      azureApiVersion: '2024-07-01-preview',
    })
  })

  it('should handle Vertex AI models with OAuth credential', async () => {
    const inputs = {
      content: 'Test content to evaluate',
      metrics: [
        {
          name: 'quality',
          description: 'Quality score',
          range: { min: 1, max: 10 },
        },
      ],
      model: 'gemini-2.0-flash-exp',
      vertexCredential: 'test-vertex-credential-id',
      vertexProject: 'test-gcp-project',
      vertexLocation: 'us-central1',
    }

    mockGetProviderFromModel.mockReturnValue('vertex')

    // Mock the database query for Vertex credential
    const mockDb = await import('@sim/db')
    const mockAccount = {
      id: 'test-vertex-credential-id',
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
    }
    ;(mockDb.db.query as any).account = { findFirst: vi.fn() }
    vi.spyOn(mockDb.db.query.account, 'findFirst').mockResolvedValue(mockAccount as any)

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ quality: 9 }),
      model: 'gemini-2.0-flash-exp',
      tokens: {},
      cost: 0,
      timing: {},
    })

    await handler.execute(mockContext, mockBlock, inputs)

    const requestBody = providerRequestBody()

    expect(requestBody).toMatchObject({
      provider: 'vertex',
      model: 'gemini-2.0-flash-exp',
      vertexProject: 'test-gcp-project',
      vertexLocation: 'us-central1',
    })
    expect(requestBody.apiKey).toBe('mock-access-token')
  })

  it('should use default model when not provided', async () => {
    const inputs = {
      content: 'Test content',
      metrics: [{ name: 'score', description: 'Score', range: { min: 0, max: 10 } }],
      apiKey: 'test-api-key',
      // No model provided - should use default
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ score: 7 }),
      model: 'claude-sonnet-5',
      tokens: {},
      cost: 0,
      timing: {},
    })

    await handler.execute(mockContext, mockBlock, inputs)

    const requestBody = providerRequestBody()

    expect(requestBody.model).toBe('claude-sonnet-5')
  })
})
