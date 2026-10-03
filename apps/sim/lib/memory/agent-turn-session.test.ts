import { createExecutionContext } from '@sim/testing'
import { setEnv } from '@sim/testing/mocks/env.mock'
import {
  executorPrincipalMock,
  executorPrincipalMockFns,
} from '@sim/testing/mocks/executor-principal.mock'
import { featureFlagsMock, featureFlagsMockFns } from '@sim/testing/mocks/feature-flags.mock'
import { piiRedactionMock, piiRedactionMockFns } from '@sim/testing/mocks/pii-redaction.mock'
import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { isRecordLike } from '@sim/utils/object'
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

const { open, save, storeArtifact, readArtifact } = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  storeArtifact: vi.fn(),
  readArtifact: vi.fn(),
}))
vi.mock('@/lib/core/config/feature-flags', () => featureFlagsMock)
vi.mock('@/lib/memory/application/agent-turns', () => ({
  openAgentMemoryTurnUseCase: { execute: open },
  saveAgentMemoryTurnUseCase: { execute: save },
  storeAgentMemoryArtifactUseCase: { execute: storeArtifact },
  readAgentMemoryArtifactUseCase: { execute: readArtifact },
}))
vi.mock('@/lib/internal/principals/executor', () => executorPrincipalMock)
vi.mock('@/lib/logs/execution/pii-redaction', () => piiRedactionMock)
vi.mock('@/tools', () => toolsMock)

import { openAgentTurnSession } from '@/lib/memory/agent-turn-session'
import { decryptMemoryCheckpoint, encryptMemoryCheckpoint } from '@/lib/memory/checkpoint-codec'
import { createJournalArtifactFixture } from '@/lib/memory/journal.test-helpers'

const executeTool = toolsMockFns.mockExecuteTool
const flag = featureFlagsMockFns.mockIsFeatureEnabled
const redact = piiRedactionMockFns.mockRedactObjectStrings as Mock<
  (value: unknown) => Promise<unknown>
>
executorPrincipalMockFns.mockCreateExecutorPrincipalFromExecutionContext.mockResolvedValue({})

import type { AgentTurnJournalState } from '@/lib/memory/turn-journal'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { getNativeConversationMessage } from '@/providers/conversation-metadata'

setEnv({ ENCRYPTION_KEY: 'ab'.repeat(32) })

function input(order = 1) {
  const ctx: ExecutionContext = {
    ...createExecutionContext({ workflowId: 'workflow-1', executionId: 'execution-1' }),
    workspaceId: 'workspace-1',
    resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
  }
  return {
    ctx,
    blockId: 'agent-1',
    nodeId: 'agent-1',
    executionOrder: order,
    conversationId: 'conversation-1',
  }
}

function step() {
  return {
    assistant: { role: 'assistant' as const, content: '' },
    calls: [
      { providerCallId: 'wire-1', toolId: 'send_email', arguments: '{"to":"person@example.test"}' },
    ],
    native: {
      providerId: 'openai' as const,
      protocol: 'responses' as const,
      model: 'model-a',
      binding: 'binding-a',
      value: [{ type: 'reasoning', encrypted_content: 'private-reasoning' }],
    },
  }
}

function redactFixture(value: unknown): unknown {
  if (typeof value === 'string') return value.replaceAll('person@example.test', '[EMAIL]')
  if (Array.isArray(value)) return value.map(redactFixture)
  if (isRecordLike(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, redactFixture(child)])
    )
  return value
}

const artifacts = createJournalArtifactFixture()

describe('durable Agent session', () => {
  beforeEach(() => {
    artifacts.values.clear()
    storeArtifact.mockImplementation(artifacts.store)
    readArtifact.mockImplementation(artifacts.read)
    flag.mockResolvedValue(true)
    open.mockResolvedValue({
      memoryId: 'memory-1',
      turnId: 'turn-1',
      revision: 0,
      encryptedState: null,
    })
    save.mockImplementation(async ({ input: request }) => ({
      revision: request.expectedRevision + 1,
    }))
    redact.mockImplementation(async (value) => value)
  })

  it('keeps retry state in memory when storage is unavailable and never claims a save', async () => {
    open.mockRejectedValue(new Error('database unavailable'))
    const session = await openAgentTurnSession(input())
    expect(session).toBeDefined()
    await session!.captureStep(step())
    const result = { success: true, output: { delivered: true } }
    await session!.recordToolResult({
      invocationId: session!.getPendingCalls()[0].invocationId,
      rawResponse: result,
      modelResponse: result,
    })
    expect(session!.getMessages('openai', 'model-a', 'binding-a')).toHaveLength(2)
    expect(save).not.toHaveBeenCalled()
  })

  it('serializes parallel outcomes, writes only complete exchanges, and encrypts private native state', async () => {
    const session = await openAgentTurnSession(input())
    const batch = step()
    batch.calls.push({ ...batch.calls[0], providerCallId: 'wire-2' })
    await session!.captureStep(batch)
    const calls = session!.getPendingCalls()
    await Promise.all(
      calls.map(async (call) => {
        const response = { success: true, output: { id: call.providerCallId } }
        await session!.recordToolResult({
          invocationId: call.invocationId,
          rawResponse: response,
          modelResponse: response,
        })
      })
    )
    expect(save.mock.calls.map(([request]) => request.input.expectedRevision)).toEqual([0, 1, 2])
    const items = save.mock.calls.flatMap(([request]) => request.input.items)
    expect(items).toHaveLength(1)
    expect(JSON.stringify(items)).not.toContain('private-reasoning')
    expect(
      items[0].data.messages.map((message: { tool_call_id?: string }) => message.tool_call_id)
    ).toEqual([undefined, 'wire-1', 'wire-2'])
    const checkpoint = await decryptMemoryCheckpoint(
      save.mock.calls.at(-1)![0].input.encryptedState
    )
    expect(checkpoint).toMatchObject({
      memoryId: 'memory-1',
      state: { version: 2, steps: [{ ref: expect.any(Object), results: expect.any(Array) }] },
    })
  })

  it('commits the final plain answer and final checkpoint atomically, only after finalization', async () => {
    const session = await openAgentTurnSession(input())
    const content = '{"answer":42}'
    await session!.captureStep({
      ...step(),
      assistant: { role: 'assistant', content },
      calls: [],
    })
    expect(save.mock.calls[0][0].input.items).toEqual([])
    expect(
      await decryptMemoryCheckpoint(save.mock.calls[0][0].input.encryptedState)
    ).not.toHaveProperty('state.final')

    await Promise.all([
      session!.finalize(content, 'model-a'),
      session!.finalize(content, 'model-a'),
    ])
    await session!.finalize(content, 'model-a')

    expect(save).toHaveBeenCalledTimes(2)
    const finalSave = save.mock.calls[1][0].input
    expect(finalSave).toMatchObject({ expectedRevision: 1, memoryId: 'memory-1', turnId: 'turn-1' })
    expect(finalSave.items).toEqual([
      expect.objectContaining({
        turnId: 'turn-1',
        appendKey: 'final',
        kind: 'message',
        data: { role: 'assistant', content },
      }),
    ])
    expect(await artifacts.inspect(finalSave.encryptedState)).toMatchObject({
      state: { final: { content, model: 'model-a' } },
    })
  })

  it('projects secrets and PII before the atomic final write', async () => {
    const request = input()
    request.ctx.resolvedSecretTraceRegistry = new ResolvedSecretTraceRegistry([
      { name: 'TOKEN', plaintext: 'private-key-value', encryptedValue: 'ciphertext' },
    ])
    request.ctx.resolvedSecretTraceRegistry.recordResolved('TOKEN', 'private-key-value')
    request.ctx.piiBlockOutputRedaction = { enabled: true, entityTypes: ['EMAIL_ADDRESS'] }
    redact.mockImplementation(async (value) => redactFixture(value))
    const session = await openAgentTurnSession(request)

    await session!.finalize('private-key-value person@example.test', 'model-a')

    expect(save).toHaveBeenCalledTimes(1)
    const requestSave = save.mock.calls[0][0].input
    expect(requestSave.items[0].data).toEqual({ role: 'assistant', content: '{{TOKEN}} [EMAIL]' })
    expect(await artifacts.inspect(requestSave.encryptedState)).toMatchObject({
      state: { final: { content: '{{TOKEN}} [EMAIL]', model: 'model-a' } },
    })
    expect(JSON.stringify(requestSave.items)).not.toContain('private-key-value')
    expect(JSON.stringify(requestSave.items)).not.toContain('person@example.test')
  })

  it.each(['oversized', 'pii-unavailable'])(
    'does not persist an unsafe final answer (%s)',
    async (failure) => {
      const request = input()
      request.ctx.piiBlockOutputRedaction = { enabled: true, entityTypes: ['EMAIL_ADDRESS'] }
      if (failure === 'pii-unavailable')
        redact.mockRejectedValue(new Error('PII service unavailable'))
      const session = await openAgentTurnSession(request)
      await expect(
        session!.finalize(
          failure === 'oversized' ? 'x'.repeat(100 * 1024 + 1) : 'person@example.test',
          'model-a'
        )
      ).resolves.toBeUndefined()
      expect(save).not.toHaveBeenCalled()
      expect(session!.getFinalResponse()).toBeUndefined()
    }
  )

  it('isolates loop iterations and reuses only an identical server-owned invocation', async () => {
    const request = input()
    const session = await openAgentTurnSession(request)
    expect(await openAgentTurnSession(request)).toBe(session)
    expect(await openAgentTurnSession({ ...request, executionOrder: 2 })).not.toBe(session)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('keeps byte signatures exact and private for a compatible Bedrock continuation', async () => {
    const session = await openAgentTurnSession(input())
    const captured = step()
    await session!.captureStep({
      ...captured,
      native: {
        providerId: 'bedrock',
        protocol: 'bedrock',
        model: 'model-a',
        binding: 'binding-a',
        value: {
          role: 'assistant',
          content: [{ reasoningContent: { redactedContent: new Uint8Array([1, 2, 3]) } }],
        },
      },
    })
    const response = { success: true, output: {} }
    await session!.recordToolResult({
      invocationId: session!.getPendingCalls()[0].invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    const messages = session!.getMessages('bedrock', 'model-a', 'binding-a')
    expect(getNativeConversationMessage(messages[0], 'bedrock')).toMatchObject({
      content: [{ reasoningContent: { redactedContent: new Uint8Array([1, 2, 3]) } }],
    })
  })

  it('redacts arguments and results and omits private native state under PII policy', async () => {
    const request = input()
    request.ctx.piiBlockOutputRedaction = { enabled: true, entityTypes: ['EMAIL_ADDRESS'] }
    redact.mockImplementation(async (value) => redactFixture(value))
    const session = await openAgentTurnSession(request)
    await session!.captureStep(step())
    const response = { success: true, output: { email: 'person@example.test' } }
    await session!.recordToolResult({
      invocationId: session!.getPendingCalls()[0].invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    const messages = session!.getMessages('openai', 'model-a', 'binding-a')
    expect(JSON.stringify(messages)).not.toContain('person@example.test')
    expect(getNativeConversationMessage(messages[0], 'responses')).toBeUndefined()
    const item = save.mock.calls.at(-1)![0].input.items[0]
    expect(JSON.stringify(item)).not.toContain('person@example.test')
  })

  it('stops new checkpoint writes after a CAS conflict while preserving completed in-memory results', async () => {
    save.mockRejectedValue(new Error('checkpoint conflict'))
    const session = await openAgentTurnSession(input())
    await session!.captureStep(step())
    const response = { success: true, output: { done: true } }
    await session!.recordToolResult({
      invocationId: session!.getPendingCalls()[0].invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    expect(save).toHaveBeenCalledTimes(1)
    expect(session!.getPendingCalls()).toEqual([])
  })

  it('retains large results in owned artifacts and restores the original recorded outcome', async () => {
    const ref = {
      __simLargeValueRef: true,
      version: 1,
      id: 'lv_abcdefghijkl',
      kind: 'object',
      size: 200000,
      key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json',
    }
    storeArtifact.mockResolvedValue({ ref, preview: 'Retained in conversation storage' })
    const session = await openAgentTurnSession(input())
    await session!.captureStep(step())
    const response = {
      success: true,
      output: { receipt: 'test-receipt', text: 'x'.repeat(120000) },
    }
    const rawResponse = { ...response, output: { ...response.output, private: 'raw-only-secret' } }
    const result = {
      invocationId: session!.getPendingCalls()[0].invocationId,
      rawResponse,
      modelResponse: response,
    }
    readArtifact.mockResolvedValue(result)
    await session!.recordToolResult(result)
    expect(storeArtifact).toHaveBeenCalledTimes(2)
    const messages = JSON.stringify(session!.getMessages('openai', 'model-a', 'binding-a'))
    expect(messages.length).toBeLessThan(10000)
    expect(messages).toContain('test-receipt')
    expect(messages).toContain('remaining tool result retained')
    expect(messages).not.toContain('raw-only-secret')
    const exchange = save.mock.calls.at(-1)![0].input.items[0]
    expect(JSON.stringify(exchange)).toContain('test-receipt')
    expect(JSON.stringify(exchange)).not.toContain('raw-only-secret')
    expect((await session!.getReplayResult(result.invocationId))?.rawResponse).toEqual(rawResponse)
    expect(readArtifact.mock.calls[0][0].input).toMatchObject({
      memoryId: 'memory-1',
      workspaceId: 'workspace-1',
    })
    readArtifact.mockResolvedValue(undefined)
    expect(
      (await session!.getReplayResult(result.invocationId))?.rawResponse.output
    ).toHaveProperty('memoryArtifact')
    expect(session!.getPendingCalls()).toEqual([])
  })

  it('redacts PII before creating a large-result preview', async () => {
    storeArtifact.mockResolvedValue({
      ref: {
        __simLargeValueRef: true,
        version: 1,
        id: 'lv_abcdefghijkl',
        kind: 'object',
        size: 200000,
        key: 'execution/workspace-1/workflow-1/execution-1/large-value-lv_abcdefghijkl.json',
      },
      preview: 'Retained in conversation storage',
    })
    const request = input()
    request.ctx.piiBlockOutputRedaction = { enabled: true, entityTypes: ['EMAIL_ADDRESS'] }
    redact.mockImplementation(async (value) => redactFixture(value))
    const session = await openAgentTurnSession(request)
    await session!.captureStep(step())
    const response = {
      success: true,
      output: { email: 'person@example.test', text: 'x'.repeat(120000) },
    }
    await session!.recordToolResult({
      invocationId: session!.getPendingCalls()[0].invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    expect(storeArtifact).toHaveBeenCalledTimes(2)
    const messages = JSON.stringify(session!.getMessages('openai', 'model-a', 'binding-a'))
    expect(messages).toContain('[EMAIL]')
    expect(messages).not.toContain('person@example.test')
    expect(JSON.stringify(save.mock.calls.at(-1)![0].input.items)).not.toContain(
      'person@example.test'
    )
  })

  it.each(['damaged ciphertext', 'invocation binding', 'memory binding', 'invalid state'])(
    'refuses an empty fresh session when a saved checkpoint has %s',
    async (failure) => {
      const first = (await openAgentTurnSession(input()))!
      await first.captureStep(step())
      const response = { success: true, output: { delivered: true } }
      await first.recordToolResult({
        invocationId: first.getPendingCalls()[0].invocationId,
        rawResponse: response,
        modelResponse: response,
      })
      let encryptedState: string = save.mock.calls.at(-1)![0].input.encryptedState
      if (failure === 'damaged ciphertext') {
        const last = encryptedState.at(-1) === '0' ? '1' : '0'
        encryptedState = `${encryptedState.slice(0, -1)}${last}`
      } else if (failure === 'invalid state') {
        const envelope = await decryptMemoryCheckpoint(encryptedState)
        if (!isRecordLike(envelope)) throw new Error('Expected checkpoint envelope')
        encryptedState = await encryptMemoryCheckpoint({ ...envelope, state: { version: 99 } })
      }
      open.mockResolvedValue({
        memoryId: failure === 'memory binding' ? 'replacement-memory' : 'memory-1',
        turnId: 'turn-1',
        revision: 2,
        encryptedState,
      })
      const retry = input(failure === 'invocation binding' ? 2 : 1)
      await expect(openAgentTurnSession(retry)).rejects.toMatchObject({ retryable: false })
      await expect(openAgentTurnSession(retry)).rejects.toMatchObject({ retryable: false })
      expect(save).toHaveBeenCalledTimes(2)
      expect(readArtifact).not.toHaveBeenCalled()
      expect(executeTool).not.toHaveBeenCalled()
    }
  )

  it.each([false, true])(
    'preserves terminal sibling identity and cost after restart (missing payload: %s)',
    async (missingPayload) => {
      const session = (await openAgentTurnSession(input()))!
      const captured = step()
      captured.calls.push({ ...captured.calls[0], providerCallId: 'wire-2' })
      await session.captureStep(captured)
      const calls = session.getPendingCalls()
      const response = {
        success: false,
        output: { cost: { total: 0.25 } },
        error: 'Terminal error',
      }
      await session.recordToolResult({
        invocationId: calls[0].invocationId,
        rawResponse: response,
        modelResponse: response,
      })
      const encryptedState = save.mock.calls.at(-1)![0].input.encryptedState
      if (missingPayload) {
        const envelope = (await decryptMemoryCheckpoint(encryptedState)) as {
          state: AgentTurnJournalState
        }
        artifacts.values.delete(envelope.state.steps[0].results[0].ref.key!)
      }
      open.mockResolvedValue({
        memoryId: 'memory-1',
        turnId: 'turn-1',
        revision: 2,
        encryptedState,
      })
      const restored = (await openAgentTurnSession(input()))!
      expect(restored.getPendingCalls()).toEqual([calls[1]])
      expect((await restored.getReplayResult(calls[0].invocationId))?.rawResponse.success).toBe(
        false
      )
      expect(restored.getUsage().cost.toolCost).toBe(0.25)
      const complete = { success: true, output: { done: true } }
      await restored.recordToolResult({
        invocationId: calls[1].invocationId,
        rawResponse: complete,
        modelResponse: complete,
      })
      expect(restored.getPendingCalls()).toEqual([])
      expect(storeArtifact).toHaveBeenCalledTimes(3)
      expect(save.mock.calls.at(-1)![0].input).toMatchObject({
        expectedRevision: 2,
        items: [expect.objectContaining({ kind: 'exchange' })],
      })
    }
  )

  it('refuses to restart tool dispatch when a journal step payload is missing', async () => {
    const session = (await openAgentTurnSession(input()))!
    await session.captureStep(step())
    const encryptedState = save.mock.calls.at(-1)![0].input.encryptedState
    artifacts.values.clear()
    open.mockResolvedValue({ memoryId: 'memory-1', turnId: 'turn-1', revision: 1, encryptedState })
    await expect(openAgentTurnSession(input())).rejects.toMatchObject({ retryable: false })
  })

  it('reads a legacy checkpoint and upgrades it to a compact journal without losing usage or results', async () => {
    const session = (await openAgentTurnSession(input()))!
    await session.captureStep(step())
    const response = { success: true, output: { done: true, cost: { total: 0.25 } } }
    const invocationId = session.getPendingCalls()[0].invocationId
    await session.recordToolResult({ invocationId, rawResponse: response, modelResponse: response })
    const legacy = await artifacts.inspect(save.mock.calls.at(-1)![0].input.encryptedState)
    open.mockResolvedValue({
      memoryId: 'memory-1',
      turnId: 'turn-1',
      revision: 2,
      encryptedState: await encryptMemoryCheckpoint(legacy),
    })
    const restored = (await openAgentTurnSession(input()))!
    expect((await restored.getReplayResult(invocationId))?.rawResponse).toEqual(response)
    await restored.recordContextUsage({
      tokens: { input: 10, output: 2, cacheRead: 3 },
      cost: { input: 0.01, output: 0.02, toolCost: 0, total: 0.03 },
    })
    const checkpoint = await decryptMemoryCheckpoint(
      save.mock.calls.at(-1)![0].input.encryptedState
    )
    expect(checkpoint).toMatchObject({
      state: { version: 2, contextUsage: { tokens: { input: 10 } } },
    })
    expect(restored.getUsage().cost.total).toBe(0.28)
    expect(restored.getMessages('openai', 'model-a', 'binding-a')).toHaveLength(2)
  })
})
