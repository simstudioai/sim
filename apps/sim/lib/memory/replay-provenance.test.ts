/** @vitest-environment node */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  execute: vi.fn(),
  storeArtifact: vi.fn(),
  readArtifact: vi.fn(),
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: async () => true }))
vi.mock('@/lib/core/config/env', () => ({ env: { ENCRYPTION_KEY: 'cd'.repeat(32) } }))
vi.mock('@/lib/memory/application/agent-turns', () => ({
  openAgentMemoryTurnUseCase: { execute: mocks.open },
  saveAgentMemoryTurnUseCase: { execute: mocks.save },
  storeAgentMemoryArtifactUseCase: { execute: mocks.storeArtifact },
  readAgentMemoryArtifactUseCase: { execute: mocks.readArtifact },
}))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: async () => ({}),
}))
vi.mock('@/lib/logs/execution/pii-redaction', () => ({
  redactObjectStrings: async (value: unknown) => value,
}))
vi.mock('@/tools', () => ({ executeTool: mocks.execute }))

import { encryptSecret } from '@/lib/core/security/encryption'
import { durableSecretProvenanceFromRegistry } from '@/lib/execution/durable-secret-provenance'
import { openAgentTurnSession } from '@/lib/memory/agent-turn-session'
import { encryptMemoryCheckpoint } from '@/lib/memory/checkpoint-codec'
import type { AgentTurnState } from '@/lib/memory/conversation-types'
import { createJournalArtifactFixture } from '@/lib/memory/journal.test-helpers'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { continuePendingConversationCalls } from '@/providers/conversation-continuation'
import { getConfiguredConversationToolBinding } from '@/providers/conversation-history'
import { executeProviderTool, runWithProviderRuntimeContext } from '@/providers/runtime-context'
import { registerProviderToolModelInputRegistry } from '@/providers/tool-input-provenance'
import type { ProviderRequest, ProviderToolConfig } from '@/providers/types'

const artifacts = createJournalArtifactFixture()

const scope = { userId: 'user-1', workspaceId: 'workspace-1' }
const secret = 'private-derived-token-abc'
const tool: ProviderToolConfig = {
  id: 'custom_lookup',
  params: {},
  parameters: { type: 'object', properties: {}, required: [] },
}

function input(registry = new ResolvedSecretTraceRegistry([], scope)) {
  const ctx: ExecutionContext = {
    ...createExecutionContext({ workflowId: 'workflow-1', executionId: 'execution-1' }),
    workspaceId: scope.workspaceId,
    userId: scope.userId,
    executorDelegationOrigin: {
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      principal: { kind: 'session', userId: scope.userId, sessionId: 'session-1' },
    },
    resolvedSecretTraceRegistry: registry,
  }
  return {
    ctx,
    blockId: 'agent-1',
    nodeId: 'agent-1',
    executionOrder: 1,
    conversationId: 'conversation-1',
  }
}

function capture(argumentsValue: string, providerCallId: string) {
  return {
    assistant: { role: 'assistant' as const, content: '' },
    calls: [
      {
        providerCallId,
        toolId: tool.id,
        arguments: argumentsValue,
        configuredToolBinding: getConfiguredConversationToolBinding(tool),
      },
    ],
    native: {
      providerId: 'openai' as const,
      protocol: 'responses' as const,
      model: 'model-a',
      binding: 'binding-a',
      value: [],
    },
  }
}

async function checkpointWithPendingCall() {
  const { encrypted } = await encryptSecret(secret)
  const registry = new ResolvedSecretTraceRegistry(
    [{ name: 'TOKEN', plaintext: secret, encryptedValue: encrypted }],
    scope
  )
  registry.recordResolved('TOKEN', secret)
  const session = (await openAgentTurnSession(input(registry)))!
  await session.captureStep(capture('{}', 'completed-wire'))
  const rawResponse = { success: true, output: { token: secret } }
  await session.recordToolResult({
    invocationId: session.getPendingCalls()[0].invocationId,
    rawResponse,
    modelResponse: rawResponse,
    provenance: durableSecretProvenanceFromRegistry(registry, rawResponse),
  })
  await session.captureStep(capture('{"token":"{{TOKEN}}"}', 'pending-wire'))
  const encryptedState: string = mocks.save.mock.calls.at(-1)![0].input.encryptedState
  return { encryptedState, session }
}

async function restore(encryptedState: string) {
  mocks.open.mockResolvedValue({
    memoryId: 'memory-1',
    turnId: 'turn-1',
    revision: 3,
    encryptedState,
  })
  const request = input()
  const session = (await openAgentTurnSession(request))!
  return { request, session }
}

describe('durable Agent replay provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    artifacts.values.clear()
    mocks.storeArtifact.mockImplementation(artifacts.store)
    mocks.readArtifact.mockImplementation(artifacts.read)
    mocks.open.mockResolvedValue({
      memoryId: 'memory-1',
      turnId: 'turn-1',
      revision: 0,
      encryptedState: null,
    })
    mocks.save.mockImplementation(async ({ input: request }) => ({
      revision: request.expectedRevision + 1,
    }))
    mocks.execute.mockResolvedValue({ success: true, output: { reflected: secret } })
  })

  it('restores secret-derived pending arguments without exposing secrets in durable model history', async () => {
    const { encryptedState } = await checkpointWithPendingCall()
    const { request, session } = await restore(encryptedState)
    const registry = request.ctx.resolvedSecretTraceRegistry!
    const modelRegistry = new ResolvedSecretTraceRegistry([], scope)
    registerProviderToolModelInputRegistry(tool, modelRegistry)
    await session.restoreProvenance(registry)
    await session.restoreProvenance(modelRegistry)
    await runWithProviderRuntimeContext(
      {
        agentConversation: session,
        resolvedSecretTraceRegistry: registry,
        executionContext: request.ctx,
      },
      () =>
        continuePendingConversationCalls(
          {
            model: 'model-a',
            workflowId: 'workflow-1',
            workspaceId: scope.workspaceId,
            tools: [tool],
          } as ProviderRequest,
          session
        )
    )
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(mocks.execute.mock.calls[0][1].token).toBe(secret)
    expect(session.getPendingCalls()).toEqual([])
    const publicHistory = JSON.stringify(session.getMessages('openai', 'model-a', 'binding-a'))
    expect(publicHistory).not.toContain(secret)
    expect(publicHistory).toContain('{{TOKEN}}')
    expect(
      JSON.stringify(mocks.save.mock.calls.flatMap(([call]) => call.input.items))
    ).not.toContain(secret)
    const completed = (await artifacts.inspect(encryptedState)) as { state: AgentTurnState }
    const replay = await runWithProviderRuntimeContext(
      { agentConversation: session, resolvedSecretTraceRegistry: registry },
      () =>
        executeProviderTool(tool.id, {
          _context: { invocationId: completed.state.steps[0].calls[0].invocationId },
        })
    )
    expect(mocks.execute).toHaveBeenCalledOnce()
    expect(replay.rawResponse.output.token).toBe(secret)
    expect(JSON.stringify(replay.modelResponse)).not.toContain(secret)
  })

  it('rejects foreign-workspace result provenance before pending tool dispatch', async () => {
    const { encryptedState } = await checkpointWithPendingCall()
    const envelope = (await artifacts.inspect(encryptedState)) as { state: AgentTurnState }
    const provenance = envelope.state.steps[0].results[0].provenance!
    if (provenance.status !== 'exact') throw new Error('Expected tracked fixture')
    provenance.entries[0].sourceWorkspaceId = 'foreign-workspace'
    const { request, session } = await restore(await encryptMemoryCheckpoint(envelope))
    await expect(
      runWithProviderRuntimeContext(
        {
          agentConversation: session,
          resolvedSecretTraceRegistry: request.ctx.resolvedSecretTraceRegistry,
        },
        async () => {
          await session.restoreProvenance(request.ctx.resolvedSecretTraceRegistry!)
          await continuePendingConversationCalls(
            {
              model: 'model-a',
              workflowId: 'workflow-1',
              workspaceId: scope.workspaceId,
              tools: [tool],
            } as ProviderRequest,
            session
          )
        }
      )
    ).rejects.toMatchObject({ retryable: false })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it.each([true, false])(
    'binds personal provenance only to its actual user (same user: %s)',
    async (sameUser) => {
      const { encryptedState } = await checkpointWithPendingCall()
      const envelope = (await artifacts.inspect(encryptedState)) as { state: AgentTurnState }
      const provenance = envelope.state.steps[0].results[0].provenance!
      if (provenance.status !== 'exact') throw new Error('Expected tracked fixture')
      provenance.entries[0].sourceWorkspaceId = undefined
      if (!sameUser) provenance.entries[0].sourceUserId = 'other-user'
      const { session } = await restore(await encryptMemoryCheckpoint(envelope))
      const registry = new ResolvedSecretTraceRegistry([], scope)
      if (!sameUser) {
        await expect(session.restoreProvenance(registry)).rejects.toMatchObject({
          retryable: false,
        })
        expect(mocks.execute).not.toHaveBeenCalled()
        return
      }
      await session.restoreProvenance(registry)
      expect(registry.resolveModelExposedEnvReferences({ token: '{{TOKEN}}' }).value).toEqual({
        token: secret,
      })
    }
  )

  it('bounds per-execution session retention and refreshes recently used entries', async () => {
    const request = input()
    const first = await openAgentTurnSession(request)
    const second = await openAgentTurnSession({ ...request, executionOrder: 2 })
    for (let order = 3; order <= 32; order++)
      await openAgentTurnSession({ ...request, executionOrder: order })
    expect(await openAgentTurnSession(request)).toBe(first)
    await openAgentTurnSession({ ...request, executionOrder: 33 })
    expect(await openAgentTurnSession(request)).toBe(first)
    expect(await openAgentTurnSession({ ...request, executionOrder: 2 })).not.toBe(second)
    expect(mocks.open).toHaveBeenCalledTimes(34)
  })

  it('releases large raw results from live state after artifact storage and hydrates only on replay', async () => {
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_abcdefghijkl',
      kind: 'object',
      size: 200000,
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json',
    }
    mocks.storeArtifact.mockResolvedValue({ ref, preview: 'Saved tool result' })
    const session = (await openAgentTurnSession(input()))!
    await session.captureStep(capture('{}', 'large-wire'))
    const invocationId = session.getPendingCalls()[0].invocationId
    const rawResponse = {
      success: true,
      output: { text: 'x'.repeat(120000), cost: { total: 0.02 } },
    }
    const result = { invocationId, rawResponse, modelResponse: rawResponse }
    mocks.readArtifact.mockResolvedValue(result)
    await session.recordToolResult(result)
    expect(session.getRecordedResult(invocationId)?.rawResponse.output.text).toBeUndefined()
    expect(JSON.stringify(session.getRecordedResult(invocationId)).length).toBeLessThan(18_000)
    expect(JSON.stringify(session.getRecordedResult(invocationId))).not.toContain('x'.repeat(9000))
    expect(session.getUsage().cost.toolCost).toBe(0.02)
    expect((await session.getReplayResult(invocationId))?.rawResponse).toEqual(rawResponse)
  })

  it.each([
    [
      'duplicate invocation IDs',
      (state: AgentTurnState) => {
        state.steps[1].calls[0].invocationId = state.steps[0].calls[0].invocationId
      },
    ],
    [
      'orphan result',
      (state: AgentTurnState) => {
        state.steps[0].results[0].invocationId = 'not-a-call'
      },
    ],
    [
      'malformed native binding',
      (state: AgentTurnState) => {
        state.steps[0].native!.binding = ''
      },
    ],
    [
      'malformed native prefix hash',
      (state: AgentTurnState) => {
        state.steps[0].native!.prefixHash = 'invalid-prefix'
      },
    ],
    [
      'unsupported native protocol',
      (state: AgentTurnState) => {
        Reflect.set(state.steps[0].native!, 'protocol', 'invented')
      },
    ],
    [
      'malformed provenance',
      (state: AgentTurnState) => {
        Reflect.set(state.steps[0].results[0], 'provenance', { status: 'exact', entries: [{}] })
      },
    ],
    [
      'final with unresolved tools',
      (state: AgentTurnState) => {
        state.final = { content: 'pretend done', model: 'model-a' }
      },
    ],
    [
      'private assistant fields',
      (state: AgentTurnState) => {
        Reflect.set(state.steps[0].assistant, 'privateCredential', secret)
      },
    ],
  ] as const)('discards a checkpoint with %s', async (_name, mutate) => {
    const { encryptedState } = await checkpointWithPendingCall()
    const envelope = (await artifacts.inspect(encryptedState)) as { state: AgentTurnState }
    mutate(envelope.state)
    const { session } = await restore(await encryptMemoryCheckpoint(envelope))
    expect(session.getPendingCalls()).toEqual([])
    expect(session.getMessages('openai', 'model-a', 'binding-a')).toEqual([])
    expect(session.getFinalResponse()).toBeUndefined()
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
