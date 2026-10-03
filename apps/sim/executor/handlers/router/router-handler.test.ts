import {
  credentialsAccessMock,
  credentialsAccessMockFns,
} from '@sim/testing/mocks/credentials-access.mock'
import { permissionsMock, permissionsMockFns } from '@sim/testing/mocks/permissions.mock'
import '@sim/testing/mocks/executor'

import { createLogger } from '@sim/logger'
import {
  authOAuthUtilsMock,
  authOAuthUtilsMockFns,
  encryptionMock,
  encryptionMockFns,
} from '@sim/testing'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { mockResolveAutoModel } = vi.hoisted(() => ({
  mockResolveAutoModel: vi.fn(),
}))

vi.mock('@/lib/workspaces/permissions/utils', () => permissionsMock)

vi.mock('@/lib/oauth/credential-service', () => authOAuthUtilsMock)
vi.mock('@/lib/core/security/encryption', () => encryptionMock)

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

import { generateRouterPrompt, generateRouterV2Prompt } from '@/blocks/blocks/router'
import { BlockType } from '@/executor/constants'
import { RouterBlockHandler } from '@/executor/handlers/router/router-handler'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { executeProviderRequest } from '@/providers'
import { getProviderFromModel } from '@/providers/utils'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

credentialsAccessMockFns.mockGetCredentialActorContext.mockResolvedValue({
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
})

const mockCheckWorkspaceAccess = permissionsMockFns.mockCheckWorkspaceAccess

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

  it('selects the same legacy destination when a fallback provider answers', async () => {
    mockExecuteProviderRequest
      .mockRejectedValueOnce(new Error('overloaded'))
      .mockResolvedValueOnce({
        content: 'target-block-1',
        model: 'claude-sonnet-5',
        tokens: { input: 10, output: 2, total: 12 },
        cost: 0.001,
      })
    const output = await handler.execute(mockContext, mockBlock, {
      prompt: 'Pick a destination',
      model: 'gpt-4o',
      fallbackModels: [{ model: 'claude-sonnet-5' }],
    })
    expect(output).toMatchObject({
      model: 'claude-sonnet-5',
      selectedPath: { blockId: 'target-block-1' },
    })
    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(2)
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

  it.each([true, false])(
    'rejects a missing target before choosing another route when an enabled sibling exists: %s',
    async (hasEnabledSibling) => {
      mockContext.workflow!.blocks = hasEnabledSibling ? [mockBlock, mockTargetBlock2] : [mockBlock]

      await expect(
        handler.execute(mockContext, mockBlock, { prompt: 'Test', model: 'sim-auto' })
      ).rejects.toThrow('Target block target-block-1 not found')
      expect(mockGenerateRouterPrompt).not.toHaveBeenCalled()
      expect(mockResolveAutoModel).not.toHaveBeenCalled()
      expect(mockExecuteProviderRequest).not.toHaveBeenCalled()
    }
  )

  it('preserves existing error-edge routing candidates and decisions', async () => {
    mockContext.workflow!.connections = [
      { source: mockBlock.id, target: mockTargetBlock1.id, sourceHandle: 'source-right' },
      { source: mockBlock.id, target: mockTargetBlock2.id, sourceHandle: 'error' },
    ]
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: 'target-block-2',
      model: 'mock-model',
    })

    const result = await handler.execute(mockContext, mockBlock, { prompt: 'Test' })

    expect(mockGenerateRouterPrompt).toHaveBeenCalledWith('Test', [
      expect.objectContaining({ id: 'target-block-1' }),
      expect.objectContaining({ id: 'target-block-2' }),
    ])
    expect(result).toMatchObject({
      selectedRoute: 'target-block-2',
      selectedPath: {
        blockId: 'target-block-2',
        blockType: 'target',
        blockTitle: 'Option B',
      },
    })
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

  it('preserves route selection and reasoning when an Auto request falls back', async () => {
    mockExecuteProviderRequest
      .mockRejectedValueOnce(new Error('overloaded'))
      .mockResolvedValueOnce({
        content: '{"route":"route-support","reasoning":"Needs assistance"}',
        model: 'claude-sonnet-5',
        tokens: { input: 10, output: 2, total: 12 },
        cost: { input: 0.0008, output: 0.0002, total: 0.001 },
      })
    const output = await handler.execute(mockContext, mockRouterV2Block, {
      context: 'Help me',
      model: 'sim-auto',
      routes: [{ id: 'route-support', title: 'Support', value: 'Needs help' }],
      fallbackModels: [{ model: 'claude-sonnet-5' }],
    })
    expect(output).toMatchObject({
      model: 'claude-sonnet-5',
      selectedRoute: 'route-support',
      reasoning: 'Needs assistance',
      cost: { total: 0.003 },
    })
    expect(mockExecuteProviderRequest.mock.calls[1][1].systemPrompt).toBe(
      'Generated V2 System Prompt'
    )
    expect(mockExecuteProviderRequest.mock.calls[1][1].responseFormat).toEqual(
      mockExecuteProviderRequest.mock.calls[0][1].responseFormat
    )
  })

  it('waits for the final retry before using a Router V2 fallback', async () => {
    mockExecuteProviderRequest.mockRejectedValueOnce(new Error('overloaded'))
    await expect(
      handler.execute(
        mockContext,
        mockRouterV2Block,
        {
          context: 'Help me',
          model: 'gpt-4o',
          routes: [{ id: 'route-support', title: 'Support', value: 'Needs help' }],
          fallbackModels: [{ model: 'claude-sonnet-5' }],
        },
        { nodeId: mockRouterV2Block.id, retry: { attempt: 1, maxTries: 2, isFinalTry: false } }
      )
    ).rejects.toThrow('overloaded')
    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(1)
  })

  it('does not ask a fallback to override a NO_MATCH decision', async () => {
    mockExecuteProviderRequest.mockResolvedValueOnce({
      content: '{"route":"NO_MATCH","reasoning":"Unrelated"}',
      model: 'gpt-4o',
    })
    await expect(
      handler.execute(mockContext, mockRouterV2Block, {
        context: 'Unrelated',
        model: 'gpt-4o',
        routes: [{ id: 'route-support', title: 'Support', value: 'Needs help' }],
        fallbackModels: [{ model: 'claude-sonnet-5' }],
      })
    ).rejects.toThrow('Router could not determine a matching route')
    expect(mockExecuteProviderRequest).toHaveBeenCalledTimes(1)
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
})
