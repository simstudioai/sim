import '@sim/testing/mocks/executor'

import { createLogger } from '@sim/logger'
import {
  authOAuthUtilsMock,
  authOAuthUtilsMockFns,
  encryptionMock,
  encryptionMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { mockResolveAutoModel, mockCheckWorkspaceAccess } = vi.hoisted(() => ({
  mockResolveAutoModel: vi.fn(),
  mockCheckWorkspaceAccess: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => ({
  checkWorkspaceAccess: mockCheckWorkspaceAccess,
}))

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)

vi.mock('@/executor/utils/credential-token', () => ({
  resolveExecutorCredentialToken: vi.fn().mockResolvedValue({ accessToken: 'mock-access-token' }),
}))

vi.mock('@/lib/credentials/access', () => ({
  canUseCredential: (access: { hasWorkspaceAccess: boolean; member: unknown; isAdmin: boolean }) =>
    access.hasWorkspaceAccess && (Boolean(access.member) || access.isAdmin),
  getCredentialActorContext: vi.fn().mockResolvedValue({
    credential: {
      id: 'test-vertex-credential',
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

import { generateRouterPrompt, generateRouterV2Prompt } from '@/blocks/blocks/router'
import { BlockType } from '@/executor/constants'
import { RouterBlockHandler } from '@/executor/handlers/router/router-handler'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

const mockGenerateRouterPrompt = generateRouterPrompt as Mock
const mockGenerateRouterV2Prompt = generateRouterV2Prompt as Mock
const mockGetProviderFromModel = getProviderFromModel as Mock
const mockExecuteProviderRequest = executeProviderRequest as Mock

/** The provider request the handler built, keyed the way the old wire body was. */
function providerRequestBody(index = 0): Record<string, unknown> {
  const [provider, request] = mockExecuteProviderRequest.mock.calls[index]
  return { provider, ...request }
}

function providerRuntimeRegistry(index = 0): ResolvedSecretTraceRegistry | undefined {
  return mockExecuteProviderRequest.mock.calls[index][2]?.resolvedSecretTraceRegistry
}

const mockLogger =
  vi.mocked(createLogger).mock.results[
    vi.mocked(createLogger).mock.calls.findIndex(([name]) => name === 'RouterBlockHandler')
  ].value

describe('RouterBlockHandler', () => {
  let handler: RouterBlockHandler
  let mockBlock: SerializedBlock
  let mockContext: ExecutionContext
  let mockWorkflow: Partial<SerializedWorkflow>
  let mockTargetBlock1: SerializedBlock
  let mockTargetBlock2: SerializedBlock

  beforeEach(() => {
    mockTargetBlock1 = {
      id: 'target-block-1',
      metadata: { id: 'target', name: 'Option A', description: 'Choose A' },
      position: { x: 100, y: 100 },
      config: { tool: 'tool_a', params: { p: 'a' } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockTargetBlock2 = {
      id: 'target-block-2',
      metadata: { id: 'target', name: 'Option B', description: 'Choose B' },
      position: { x: 100, y: 150 },
      config: { tool: 'tool_b', params: { p: 'b' } },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockBlock = {
      id: 'router-block-1',
      metadata: { id: BlockType.ROUTER, name: 'Test Router' },
      position: { x: 50, y: 50 },
      config: { tool: BlockType.ROUTER, params: {} },
      inputs: { prompt: 'string', model: 'string' },
      outputs: {},
      enabled: true,
    }
    mockWorkflow = {
      blocks: [mockBlock, mockTargetBlock1, mockTargetBlock2],
      connections: [
        {
          source: mockBlock.id,
          target: mockTargetBlock1.id,
          sourceHandle: 'condition-then1',
        },
        {
          source: mockBlock.id,
          target: mockTargetBlock2.id,
          sourceHandle: 'condition-else1',
        },
      ],
    }

    handler = new RouterBlockHandler({})

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
      workflow: mockWorkflow as SerializedWorkflow,
    }

    vi.clearAllMocks()
    encryptionMockFns.mockDecryptSecret.mockResolvedValue({ decrypted: 'test-decrypted' })

    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })

    authOAuthUtilsMockFns.mockResolveOAuthAccountId.mockResolvedValue({
      accountId: 'test-vertex-credential-id',
      usedCredentialTable: false,
    })
    authOAuthUtilsMockFns.mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshed: false,
    })
    mockGetProviderFromModel.mockReturnValue('openai')
    mockGenerateRouterPrompt.mockReturnValue('Generated System Prompt')
    mockResolveAutoModel.mockResolvedValue({
      model: 'fireworks/glm-5.2',
      tier: '2',
      decidedBy: 'llm',
      billableRoutingCost: 0.002,
    })

    mockExecuteProviderRequest.mockResolvedValue({
      content: 'target-block-1',
      model: 'mock-model',
      tokens: { input: 100, output: 5, total: 105 },
      cost: 0.003,
      timing: { total: 300 },
    })
  })

  it('should handle router blocks', () => {
    expect(handler.canHandle(mockBlock)).toBe(true)
    const nonRouterBlock: SerializedBlock = {
      ...mockBlock,
      metadata: { id: 'other' },
    }
    expect(handler.canHandle(nonRouterBlock)).toBe(false)
  })

  it('should execute router block correctly and select a path', async () => {
    const inputs = {
      prompt: 'Choose the best option.',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      temperature: 0.1,
    }

    const expectedTargetBlocks = [
      {
        id: 'target-block-1',
        type: 'target',
        title: 'Option A',
        description: 'Choose A',
        subBlocks: {
          p: 'a',
          systemPrompt: '',
        },
        currentState: undefined,
      },
      {
        id: 'target-block-2',
        type: 'target',
        title: 'Option B',
        description: 'Choose B',
        subBlocks: {
          p: 'b',
          systemPrompt: '',
        },
        currentState: undefined,
      },
    ]

    const result = await handler.execute(mockContext, mockBlock, inputs)

    expect(mockGenerateRouterPrompt).toHaveBeenCalledWith(inputs.prompt, expectedTargetBlocks)
    expect(mockGetProviderFromModel).toHaveBeenCalledWith('gpt-4o')
    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(1)

    const requestBody = providerRequestBody()
    expect(requestBody).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      systemPrompt: 'Generated System Prompt',
      context: JSON.stringify([{ role: 'user', content: 'Choose the best option.' }]),
      temperature: 0.1,
    })

    expect(result).toEqual({
      prompt: 'Choose the best option.',
      model: 'mock-model',
      tokens: { input: 100, output: 5, total: 105 },
      cost: {
        input: 0,
        output: 0,
        total: 0,
      },
      selectedPath: {
        blockId: 'target-block-1',
        blockType: 'target',
        blockTitle: 'Option A',
      },
      selectedRoute: 'target-block-1',
    })
  })

  it('sends only model-visible legacy router provenance and excludes credentials', async () => {
    const promptSecret = 'resolved-router-prompt'
    const credentialSecret = 'resolved-router-credential'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'PROMPT_SECRET',
        plaintext: promptSecret,
        encryptedValue: 'encrypted-router-prompt',
      },
      {
        name: 'API_KEY',
        plaintext: credentialSecret,
        encryptedValue: 'encrypted-router-credential',
      },
    ])
    registry.recordResolvedAtInputPath('PROMPT_SECRET', promptSecret, ['prompt'])
    registry.recordResolvedInputProjection(['prompt'], promptSecret, '{{PROMPT_SECRET}}')
    registry.recordResolved('API_KEY', credentialSecret)
    mockContext.resolvedSecretTraceRegistry = registry

    await handler.execute(mockContext, mockBlock, {
      prompt: promptSecret,
      model: 'gpt-4o',
      apiKey: credentialSecret,
    })

    const requestBody = providerRequestBody()
    expect(providerRuntimeRegistry()?.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [
        {
          encryptedValue: 'encrypted-router-prompt',
          name: 'PROMPT_SECRET',
        },
      ],
    })
    expect(requestBody.apiKey).toBe(credentialSecret)
    expect(mockGenerateRouterPrompt).toHaveBeenCalledWith('{{PROMPT_SECRET}}', expect.any(Array))
  })

  it('omits a prior target state when only aggregate secret provenance is available', async () => {
    const stateSecret = 'x'
    const encryptedStateSecret = 'encrypted-router-state'
    const rawState = { result: stateSecret, ordinary: 'Box remains raw state' }
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'STATE_SECRET',
        plaintext: stateSecret,
        encryptedValue: encryptedStateSecret,
      },
    ])
    mockContext.resolvedSecretTraceRegistry = registry
    mockContext.blockStates = new Map([
      [
        mockTargetBlock1.id,
        {
          output: rawState,
          executed: true,
          executionTime: 1,
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [{ name: 'STATE_SECRET', encryptedValue: encryptedStateSecret }],
          },
        },
      ],
    ])
    encryptionMockFns.mockDecryptSecret.mockImplementation(async (encryptedValue: string) => ({
      decrypted: encryptedValue === encryptedStateSecret ? stateSecret : 'test-decrypted',
    }))

    await handler.execute(mockContext, mockBlock, {
      prompt: 'Choose the best option.',
      model: 'gpt-4o',
    })

    expect(mockGenerateRouterPrompt).toHaveBeenCalledWith(
      'Choose the best option.',
      expect.arrayContaining([
        expect.objectContaining({
          id: mockTargetBlock1.id,
          subBlocks: expect.objectContaining({ p: 'a' }),
          currentState: undefined,
        }),
      ])
    )
    expect(rawState).toEqual({ result: stateSecret, ordinary: 'Box remains raw state' })
    expect(mockTargetBlock1.config.params).toEqual({ p: 'a' })

    expect(providerRuntimeRegistry()?.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [],
    })
  })

  it('keeps an ordinary prior target state with exact-empty provenance unchanged', async () => {
    const rawState = { result: 'x', ordinary: 'Box remains raw state' }
    mockContext.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([])
    mockContext.blockStates = new Map([
      [
        mockTargetBlock1.id,
        {
          output: rawState,
          executed: true,
          executionTime: 1,
          resolvedSecretTraceProvenance: {
            version: 1,
            complete: true,
            entries: [],
          },
        },
      ],
    ])

    await handler.execute(mockContext, mockBlock, {
      prompt: 'Choose the best option.',
      model: 'gpt-4o',
    })

    expect(mockGenerateRouterPrompt).toHaveBeenCalledWith(
      'Choose the best option.',
      expect.arrayContaining([
        expect.objectContaining({
          id: mockTargetBlock1.id,
          currentState: rawState,
        }),
      ])
    )
    expect(rawState).toEqual({ result: 'x', ordinary: 'Box remains raw state' })
  })

  it('keeps the legacy router request shape when no provenance registry exists', async () => {
    await handler.execute(mockContext, mockBlock, {
      prompt: 'Choose the best option.',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
    })

    expect(providerRuntimeRegistry()).toBeUndefined()
  })

  it('bills the cost the provider proxy decided rather than recomputing it', async () => {
    // The proxy already resolved key provenance and the margin; recomputing
    // here would re-charge a BYOK caller the proxy correctly zeroed.
    mockExecuteProviderRequest.mockResolvedValue({
      content: 'target-block-1',
      model: 'mock-model',
      tokens: { input: 100, output: 5, total: 105 },
      cost: { input: 0.004, output: 0.002, total: 0.006 },
      timing: { total: 300 },
    })

    const result = await handler.execute(mockContext, mockBlock, {
      prompt: 'Choose the best option.',
    })

    expect((result as { cost: unknown }).cost).toEqual({
      input: 0.004,
      output: 0.002,
      total: 0.006,
    })
  })

  it('refuses to reach the provider without an execution subject', async () => {
    mockContext.userId = undefined

    await expect(
      handler.execute(mockContext, mockBlock, { prompt: 'Choose the best option.' })
    ).rejects.toThrow('Unauthorized')
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('refuses to reach the provider when the subject lost workspace access', async () => {
    mockContext.workspaceId = 'test-workspace'
    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: false })

    await expect(
      handler.execute(mockContext, mockBlock, { prompt: 'Choose the best option.' })
    ).rejects.toThrow('Forbidden')
    expect(mockCheckWorkspaceAccess).toHaveBeenCalledWith('test-workspace', 'test-user')
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('should throw error if target block is missing', async () => {
    const inputs = { prompt: 'Test' }
    mockContext.workflow!.blocks = [mockBlock, mockTargetBlock2]

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Target block target-block-1 not found'
    )
    expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
  })

  it('should throw error if LLM response is not a valid target block ID', async () => {
    const inputs = { prompt: 'Test', apiKey: 'test-api-key' }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: 'invalid-block-id',
      model: 'mock-model',
      tokens: {},
      cost: 0,
      timing: {},
    })

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow(
      'Invalid routing decision: invalid-block-id'
    )
  })

  it('does not log sensitive provider content when routing fails', async () => {
    const plaintext = 'router-provider-plaintext-secret'
    const content = `${plaintext} __var_API_KEY __sim_runtime`

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content,
      model: 'mock-model',
      tokens: {},
      cost: 0,
      timing: {},
    })

    await expect(handler.execute(mockContext, mockBlock, { prompt: 'Test' })).rejects.toThrow(
      `Invalid routing decision: ${content.toLowerCase()}`
    )

    expect(mockLogger.error).toHaveBeenCalledWith('Invalid routing decision', {
      responseContentType: 'string',
      responseContentLength: content.length,
      availableBlockCount: 2,
    })
    expect(mockLogger.error).toHaveBeenCalledWith('Router execution failed', {
      errorName: 'Error',
    })
    const logged = JSON.stringify(mockLogger.error.mock.calls)
    expect(logged).not.toContain(plaintext)
    expect(logged).not.toContain('__var_')
    expect(logged).not.toContain('__sim_')
  })

  it('should use default model and temperature if not provided', async () => {
    const inputs = { prompt: 'Choose.', apiKey: 'test-api-key' }

    await handler.execute(mockContext, mockBlock, inputs)

    expect(mockGetProviderFromModel).toHaveBeenCalledWith('claude-sonnet-5')

    const requestBody = providerRequestBody()
    expect(requestBody).toMatchObject({
      model: 'claude-sonnet-5',
      temperature: 0.1,
    })
  })

  it('should handle server error responses', async () => {
    const inputs = { prompt: 'Test error handling.', apiKey: 'test-api-key' }

    mockExecuteProviderRequest.mockRejectedValueOnce(new Error('Server error'))

    await expect(handler.execute(mockContext, mockBlock, inputs)).rejects.toThrow('Server error')
  })

  it('does not log sensitive provider errors while preserving the thrown error', async () => {
    const providerError = 'provider-plaintext-secret __var_API_KEY __sim_runtime'

    mockExecuteProviderRequest.mockRejectedValueOnce(new Error(providerError))

    await expect(handler.execute(mockContext, mockBlock, { prompt: 'Test' })).rejects.toThrow(
      providerError
    )

    expect(mockLogger.error).toHaveBeenCalledWith('Router execution failed', {
      errorName: 'Error',
    })
    const logged = JSON.stringify(mockLogger.error.mock.calls)
    expect(logged).not.toContain('provider-plaintext-secret')
    expect(logged).not.toContain('__var_')
    expect(logged).not.toContain('__sim_')
  })

  it('should handle Azure OpenAI models with endpoint and API version', async () => {
    const inputs = {
      prompt: 'Choose the best option.',
      model: 'gpt-4o',
      apiKey: 'test-azure-key',
      azureEndpoint: 'https://test.openai.azure.com',
      azureApiVersion: '2024-07-01-preview',
    }

    mockGetProviderFromModel.mockReturnValue('azure-openai')

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
      prompt: 'Choose the best option.',
      model: 'gemini-2.0-flash-exp',
      vertexCredential: 'test-vertex-credential-id',
      vertexProject: 'test-gcp-project',
      vertexLocation: 'us-central1',
    }

    mockGetProviderFromModel.mockReturnValue('vertex')

    const mockDb = await import('@sim/db')
    const mockAccount = {
      id: 'test-vertex-credential-id',
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresAt: new Date(Date.now() + 3600000),
    }
    ;(mockDb.db.query as any).account = { findFirst: vi.fn() }
    vi.spyOn(mockDb.db.query.account, 'findFirst').mockResolvedValue(mockAccount as any)

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
})

describe('RouterBlockHandler V2', () => {
  let handler: RouterBlockHandler
  let mockRouterV2Block: SerializedBlock
  let mockContext: ExecutionContext
  let mockWorkflow: Partial<SerializedWorkflow>
  let mockTargetBlock1: SerializedBlock
  let mockTargetBlock2: SerializedBlock

  beforeEach(() => {
    mockTargetBlock1 = {
      id: 'target-block-1',
      metadata: { id: 'agent', name: 'Support Agent' },
      position: { x: 100, y: 100 },
      config: { tool: 'agent', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockTargetBlock2 = {
      id: 'target-block-2',
      metadata: { id: 'agent', name: 'Sales Agent' },
      position: { x: 100, y: 150 },
      config: { tool: 'agent', params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockRouterV2Block = {
      id: 'router-v2-block-1',
      metadata: { id: BlockType.ROUTER_V2, name: 'Test Router V2' },
      position: { x: 50, y: 50 },
      config: { tool: BlockType.ROUTER_V2, params: {} },
      inputs: {},
      outputs: {},
      enabled: true,
    }
    mockWorkflow = {
      blocks: [mockRouterV2Block, mockTargetBlock1, mockTargetBlock2],
      connections: [
        {
          source: mockRouterV2Block.id,
          target: mockTargetBlock1.id,
          sourceHandle: 'router-route-support',
        },
        {
          source: mockRouterV2Block.id,
          target: mockTargetBlock2.id,
          sourceHandle: 'router-route-sales',
        },
      ],
    }

    handler = new RouterBlockHandler({})

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
      workflow: mockWorkflow as SerializedWorkflow,
    }

    vi.clearAllMocks()

    mockCheckWorkspaceAccess.mockResolvedValue({ hasAccess: true })

    authOAuthUtilsMockFns.mockResolveOAuthAccountId.mockResolvedValue({
      accountId: 'test-vertex-credential-id',
      usedCredentialTable: false,
    })
    authOAuthUtilsMockFns.mockRefreshTokenIfNeeded.mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshed: false,
    })
    mockGetProviderFromModel.mockReturnValue('openai')
    mockGenerateRouterV2Prompt.mockReturnValue('Generated V2 System Prompt')
    mockResolveAutoModel.mockResolvedValue({
      model: 'fireworks/glm-5.2',
      tier: '2',
      decidedBy: 'llm',
      billableRoutingCost: 0.002,
    })
  })

  it('should handle router_v2 blocks', () => {
    expect(handler.canHandle(mockRouterV2Block)).toBe(true)
  })

  it('should execute router V2 and return reasoning', async () => {
    const inputs = {
      context: 'I need help with a billing issue',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([
        {
          id: 'route-support',
          title: 'Support',
          value: 'Customer support inquiries',
        },
        {
          id: 'route-sales',
          title: 'Sales',
          value: 'Sales and pricing questions',
        },
      ]),
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({
        route: 'route-support',
        reasoning: 'The user mentioned a billing issue which is a customer support matter.',
      }),
      model: 'gpt-4o',
      tokens: { input: 150, output: 25, total: 175 },
    })

    const result = await handler.execute(mockContext, mockRouterV2Block, inputs)

    expect(result).toMatchObject({
      context: 'I need help with a billing issue',
      model: 'gpt-4o',
      selectedRoute: 'route-support',
      reasoning: 'The user mentioned a billing issue which is a customer support matter.',
      selectedPath: {
        blockId: 'target-block-1',
        blockType: 'agent',
        blockTitle: 'Support Agent',
      },
    })
  })

  it('sends only model-visible router V2 provenance and excludes credentials', async () => {
    const contextSecret = 'resolved-router-v2-context'
    const credentialSecret = 'resolved-router-v2-credential'
    const registry = new ResolvedSecretTraceRegistry([
      {
        name: 'CONTEXT_SECRET',
        plaintext: contextSecret,
        encryptedValue: 'encrypted-router-v2-context',
      },
      {
        name: 'API_KEY',
        plaintext: credentialSecret,
        encryptedValue: 'encrypted-router-v2-credential',
      },
    ])
    registry.recordResolvedAtInputPath('CONTEXT_SECRET', contextSecret, ['context'])
    registry.recordResolvedInputProjection(['context'], contextSecret, '{{CONTEXT_SECRET}}')
    registry.recordResolved('API_KEY', credentialSecret)
    mockContext.resolvedSecretTraceRegistry = registry
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ route: 'route-support', reasoning: 'Matched support.' }),
      model: 'gpt-4o',
      tokens: { input: 10, output: 5, total: 15 },
    })

    await handler.execute(mockContext, mockRouterV2Block, {
      context: contextSecret,
      model: 'gpt-4o',
      apiKey: credentialSecret,
      routes: [{ id: 'route-support', title: 'Support', value: 'Support requests' }],
    })

    const requestBody = providerRequestBody()
    expect(providerRuntimeRegistry()?.exportProvenance()).toEqual({
      version: 1,
      complete: true,
      entries: [
        {
          encryptedValue: 'encrypted-router-v2-context',
          name: 'CONTEXT_SECRET',
        },
      ],
    })
    expect(requestBody.apiKey).toBe(credentialSecret)
    expect(mockGenerateRouterV2Prompt).toHaveBeenCalledWith('{{CONTEXT_SECRET}}', expect.any(Array))
  })

  it('keeps the router V2 request shape when no provenance registry exists', async () => {
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({ route: 'route-support', reasoning: 'Matched support.' }),
      model: 'gpt-4o',
      tokens: { input: 10, output: 5, total: 15 },
    })

    await handler.execute(mockContext, mockRouterV2Block, {
      context: 'Support request',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: [{ id: 'route-support', title: 'Support', value: 'Support requests' }],
    })

    expect(providerRuntimeRegistry()).toBeUndefined()
  })

  it('resolves sim-auto before executing router V2 and preserves its public identity', async () => {
    const inputs = {
      context: 'How do I get Tableau on my work laptop?',
      model: 'sim-auto',
      routes: [
        { id: 'route-support', title: 'Support', value: 'Something is broken' },
        {
          id: 'route-sales',
          title: 'Request',
          value: 'User wants something new',
        },
      ],
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({
        route: 'route-sales',
        reasoning: 'This is a new request.',
      }),
      model: 'fireworks/glm-5.2',
      tokens: { input: 100, output: 20, total: 120 },
      cost: { input: 0.001, output: 0.0005, total: 0.0015 },
    })

    const result = await handler.execute(mockContext, mockRouterV2Block, inputs)

    expect(mockResolveAutoModel).toHaveBeenCalledWith({
      ctx: mockContext,
      blockId: mockRouterV2Block.id,
      signals: expect.objectContaining({
        lastMessage: inputs.context,
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
      systemPrompt: 'Sim auto system preamble\n\nGenerated V2 System Prompt',
    })
    expect(result).toMatchObject({
      model: 'sim-auto',
      selectedRoute: 'route-sales',
      cost: {
        input: 0.001,
        output: 0.0005,
        routing: 0.002,
        total: 0.0035,
      },
    })
  })

  it('should include responseFormat in provider request', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([{ id: 'route-1', title: 'Route 1', value: 'Description 1' }]),
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({
        route: 'route-1',
        reasoning: 'Test reasoning',
      }),
      model: 'gpt-4o',
      tokens: { input: 100, output: 20, total: 120 },
    })

    await handler.execute(mockContext, mockRouterV2Block, inputs)

    const requestBody = providerRequestBody()

    expect(requestBody.responseFormat).toEqual({
      name: 'router_response',
      schema: {
        type: 'object',
        properties: {
          route: {
            type: 'string',
            description: 'The selected route ID or NO_MATCH',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of why this route was chosen',
          },
        },
        required: ['route', 'reasoning'],
        additionalProperties: false,
      },
      strict: true,
    })
  })

  it('should handle NO_MATCH response with reasoning', async () => {
    const inputs = {
      context: 'Random unrelated query',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([{ id: 'route-1', title: 'Route 1', value: 'Specific topic' }]),
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({
        route: 'NO_MATCH',
        reasoning: 'The query does not relate to any available route.',
      }),
      model: 'gpt-4o',
      tokens: { input: 100, output: 20, total: 120 },
    })

    await expect(handler.execute(mockContext, mockRouterV2Block, inputs)).rejects.toThrow(
      'Router could not determine a matching route: The query does not relate to any available route.'
    )
  })

  it('should throw error for invalid route ID in response', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([{ id: 'route-1', title: 'Route 1', value: 'Description' }]),
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({
        route: 'invalid-route',
        reasoning: 'Some reasoning',
      }),
      model: 'gpt-4o',
      tokens: { input: 100, output: 20, total: 120 },
    })

    await expect(handler.execute(mockContext, mockRouterV2Block, inputs)).rejects.toThrow(
      /Router could not determine a valid route/
    )
  })

  it('should handle routes passed as array instead of JSON string', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: [{ id: 'route-1', title: 'Route 1', value: 'Description' }],
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: JSON.stringify({
        route: 'route-1',
        reasoning: 'Matched route 1',
      }),
      model: 'gpt-4o',
      tokens: { input: 100, output: 20, total: 120 },
    })

    const result = await handler.execute(mockContext, mockRouterV2Block, inputs)

    expect(result.selectedRoute).toBe('route-1')
    expect(result.reasoning).toBe('Matched route 1')
  })

  it('should throw error when no routes are defined', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: '[]',
    }

    await expect(handler.execute(mockContext, mockRouterV2Block, inputs)).rejects.toThrow(
      'No routes defined for router'
    )
  })

  it('does not log sensitive resolved route input when JSON parsing fails', async () => {
    const plaintext = 'router-input-plaintext-secret'
    const routes = `[{"id":"${plaintext} __var_API_KEY __sim_runtime"`

    await expect(
      handler.execute(mockContext, mockRouterV2Block, {
        context: 'Test context',
        routes,
      })
    ).rejects.toThrow('No routes defined for router')

    expect(mockLogger.error).toHaveBeenCalledWith('Failed to parse routes', {
      errorName: 'SyntaxError',
      inputType: 'string',
      inputLength: routes.length,
    })
    const logged = JSON.stringify(mockLogger.error.mock.calls)
    expect(logged).not.toContain(plaintext)
    expect(logged).not.toContain('__var_')
    expect(logged).not.toContain('__sim_')
  })

  it('should handle fallback when JSON parsing fails', async () => {
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      apiKey: 'test-api-key',
      routes: JSON.stringify([{ id: 'route-1', title: 'Route 1', value: 'Description' }]),
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: 'route-1',
      model: 'gpt-4o',
      tokens: { input: 100, output: 5, total: 105 },
    })

    const result = await handler.execute(mockContext, mockRouterV2Block, inputs)

    expect(result.selectedRoute).toBe('route-1')
    expect(result.reasoning).toBe('')
  })

  it('does not log sensitive invalid structured responses', async () => {
    const plaintext = 'router-v2-response-plaintext-secret'
    const content = `${plaintext} __var_API_KEY __sim_runtime`
    const inputs = {
      context: 'Test context',
      model: 'gpt-4o',
      routes: [{ id: 'route-1', title: 'Route 1', value: 'Description' }],
    }

    mockExecuteProviderRequest.mockResolvedValueOnce({
      content,
      model: 'gpt-4o',
      tokens: { input: 100, output: 5, total: 105 },
    })

    await expect(handler.execute(mockContext, mockRouterV2Block, inputs)).rejects.toThrow(content)

    expect(mockLogger.error).toHaveBeenCalledWith(
      'Router response was not valid JSON despite responseFormat',
      {
        errorName: 'SyntaxError',
        responseContentType: 'string',
        responseContentLength: content.length,
      }
    )
    expect(mockLogger.error).toHaveBeenCalledWith('Invalid routing decision', {
      responseContentType: 'string',
      responseContentLength: content.length,
      availableRouteCount: 1,
    })
    expect(mockLogger.error).toHaveBeenCalledWith('Router V2 execution failed', {
      errorName: 'Error',
    })
    const logged = JSON.stringify(mockLogger.error.mock.calls)
    expect(logged).not.toContain(plaintext)
    expect(logged).not.toContain('__var_')
    expect(logged).not.toContain('__sim_')
  })
})
