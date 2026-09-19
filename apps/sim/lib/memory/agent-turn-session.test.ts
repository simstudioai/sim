/** @vitest-environment node */
import { createExecutionContext } from '@sim/testing'
import { isRecordLike } from '@sim/utils/object'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { open, save, flag, redact, storeArtifact, readArtifact, executeTool } = vi.hoisted(() => ({
  open: vi.fn(),
  save: vi.fn(),
  flag: vi.fn(),
  redact: vi.fn(),
  storeArtifact: vi.fn(),
  readArtifact: vi.fn(),
  executeTool: vi.fn(),
}))
vi.mock('@/lib/core/config/feature-flags', () => ({ isFeatureEnabled: flag }))
vi.mock('@/lib/core/config/env', () => ({ env: { ENCRYPTION_KEY: 'ab'.repeat(32) } }))
vi.mock('@/lib/memory/application/agent-turns', () => ({
  openAgentMemoryTurnUseCase: { execute: open },
  saveAgentMemoryTurnUseCase: { execute: save },
  storeAgentMemoryArtifactUseCase: { execute: storeArtifact },
  readAgentMemoryArtifactUseCase: { execute: readArtifact },
}))
vi.mock('@/lib/internal/principals/executor', () => ({
  createExecutorPrincipalFromExecutionContext: vi.fn(async () => ({})),
}))
vi.mock('@/lib/logs/execution/pii-redaction', () => ({ redactObjectStrings: redact }))
vi.mock('@/tools', () => ({ executeTool }))

import { openAgentTurnSession } from '@/lib/memory/agent-turn-session'
import { decryptMemoryCheckpoint, encryptMemoryCheckpoint } from '@/lib/memory/checkpoint-codec'
import { createJournalArtifactFixture } from '@/lib/memory/journal.test-helpers'
import type { AgentTurnJournalState } from '@/lib/memory/turn-journal'
import type { ExecutionContext } from '@/executor/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { getNativeConversationMessage } from '@/providers/conversation-metadata'
import { executeProviderTool, runWithProviderRuntimeContext } from '@/providers/runtime-context'

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
    vi.clearAllMocks()
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

  it.each(['', '   '])(
    'finishes an empty answer without inventing a public assistant message',
    async (content) => {
      const session = await openAgentTurnSession(input())
      await session!.finalize(content, 'model-a')
      expect(save).toHaveBeenCalledTimes(1)
      expect(save.mock.calls[0][0].input.items).toEqual([])
      expect(await artifacts.inspect(save.mock.calls[0][0].input.encryptedState)).toHaveProperty(
        'state.final.content',
        content
      )
    }
  )

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

  it('degrades an unavailable atomic final write without a separate plain-message write', async () => {
    save.mockRejectedValue(new Error('database unavailable'))
    const session = await openAgentTurnSession(input())
    await expect(session!.finalize('Completed answer', 'model-a')).resolves.toBeUndefined()
    await session!.finalize('Completed answer', 'model-a')
    expect(save).toHaveBeenCalledTimes(1)
    expect(save.mock.calls[0][0].input.items).toHaveLength(1)
    expect(session!.getFinalResponse()).toEqual({ content: 'Completed answer', model: 'model-a' })
  })

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

  it('keeps the capture switch off without opening or upgrading a conversation', async () => {
    flag.mockResolvedValue(false)
    expect(await openAgentTurnSession(input())).toBeUndefined()
    expect(open).not.toHaveBeenCalled()
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

  it.each([
    { size: 120000, success: true, failsStorage: true },
    { size: 9 * 1024 * 1024, success: false, failsStorage: false },
  ])(
    'bounds an oversized terminal result when its artifact is unavailable ($size bytes)',
    async ({ size, success, failsStorage }) => {
      const session = await openAgentTurnSession(input())
      await session!.captureStep(step())
      const invocationId = session!.getPendingCalls()[0].invocationId
      if (failsStorage) storeArtifact.mockRejectedValue(new Error('artifact storage unavailable'))
      else storeArtifact.mockResolvedValue(undefined)
      const response = {
        success,
        output: { text: 'large-result-value'.repeat(Math.ceil(size / 18)), cost: { total: 0.25 } },
        ...(!success ? { error: 'Upstream rejected the operation' } : {}),
      }
      executeTool.mockResolvedValue(response)
      const params = { _context: { invocationId } }

      const live = await runWithProviderRuntimeContext({ agentConversation: session }, () =>
        executeProviderTool('send_email', params)
      )
      const replay = await runWithProviderRuntimeContext({ agentConversation: session }, () =>
        executeProviderTool('send_email', params)
      )

      expect(live.rawResponse).toBe(response)
      expect(live.modelResponse.output.text).toBe(response.output.text)
      expect(executeTool).toHaveBeenCalledTimes(1)
      expect(session!.getPendingCalls()).toEqual([])
      const recorded = session!.getRecordedResult(invocationId)
      expect(JSON.stringify(recorded).length).toBeLessThan(2000)
      expect(JSON.stringify(recorded)).not.toContain('large-result-value')
      expect(recorded?.rawResponse).toMatchObject({
        success,
        output: { memoryResultUnavailable: true, cost: { total: 0.25 } },
        ...(!success ? { error: 'Upstream rejected the operation' } : {}),
      })
      expect(replay.rawResponse).toMatchObject({
        success,
        output: { memoryResultUnavailable: true },
      })
      expect(session!.getUsage().cost.toolCost).toBe(0.25)
      await session!.captureStep({
        ...step(),
        calls: [],
        assistant: { role: 'assistant', content: 'Finished' },
      })
      expect(save).toHaveBeenCalledTimes(1)
      expect(session!.getRecordedResult(invocationId)).toEqual(recorded)
    }
  )

  it('retains ordinary small results in memory during a checkpoint outage', async () => {
    save.mockRejectedValue(new Error('database unavailable'))
    const session = await openAgentTurnSession(input())
    await session!.captureStep(step())
    const invocationId = session!.getPendingCalls()[0].invocationId
    const response = { success: true, output: { text: 'Small complete result' } }
    await session!.recordToolResult({
      invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    expect(session!.getRecordedResult(invocationId)?.rawResponse).toEqual(response)
    expect(session!.getRecordedResult(invocationId)?.modelResponse).toEqual(response)
  })

  it('does not attach another invocation or recreated conversation journal', async () => {
    const first = await openAgentTurnSession(input())
    await first!.captureStep(step())
    const encryptedState = save.mock.calls.at(-1)![0].input.encryptedState
    open.mockResolvedValue({
      memoryId: 'replacement-memory',
      turnId: 'replacement-turn',
      revision: 2,
      encryptedState,
    })
    const replacement = await openAgentTurnSession(input(2))
    expect(replacement!.getPendingCalls()).toEqual([])
    expect(replacement!.getMessages('openai', 'model-a', 'binding-a')).toEqual([])
  })

  it('writes payloads once while a long invocation grows beyond the old snapshot byte limit', async () => {
    const session = (await openAgentTurnSession(input()))!
    for (let index = 0; index < 50; index++) {
      const captured = step()
      captured.native.value[0].encrypted_content = 'private-native-payload'.repeat(5500)
      await session.captureStep(captured)
      const response = { success: true, output: { text: 'result-value'.repeat(300) } }
      await session.recordToolResult({
        invocationId: session.getPendingCalls()[0].invocationId,
        rawResponse: response,
        modelResponse: response,
      })
    }
    expect(save).toHaveBeenCalledTimes(100)
    expect(storeArtifact).toHaveBeenCalledTimes(100)
    const totalPayloadBytes = [...artifacts.values.values()].reduce<number>(
      (total, value) => total + Buffer.byteLength(JSON.stringify(value)),
      0
    )
    expect(totalPayloadBytes).toBeGreaterThan(2 * 1024 * 1024)
    expect(totalPayloadBytes).toBeLessThan(8 * 1024 * 1024)
    const encryptedState: string = save.mock.calls.at(-1)![0].input.encryptedState
    expect(Buffer.byteLength(encryptedState)).toBeLessThan(120_000)
    const manifest = JSON.stringify(await decryptMemoryCheckpoint(encryptedState))
    expect(manifest).not.toContain('private-native-payload')
    expect(manifest).not.toContain('result-value')

    open.mockResolvedValue({
      memoryId: 'memory-1',
      turnId: 'turn-1',
      revision: 100,
      encryptedState,
    })
    const restored = (await openAgentTurnSession(input()))!
    expect(restored.getPendingCalls()).toEqual([])
    expect(restored.getMessages('openai', 'model-a', 'binding-a')).toHaveLength(100)
  })

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

  it('fails closed when the repository refuses an oversized saved checkpoint', async () => {
    open.mockRejectedValue(
      Object.assign(new Error('Checkpoint too large'), { code: 'payload_too_large' })
    )
    await expect(openAgentTurnSession(input())).rejects.toMatchObject({ retryable: false })
    expect(save).not.toHaveBeenCalled()
    expect(executeTool).not.toHaveBeenCalled()
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

  it('bounds model-visible results below the storage threshold and reuses their artifact for the journal', async () => {
    const session = (await openAgentTurnSession(input()))!
    await session.captureStep(step())
    const response = { success: true, output: { text: 'large-model-value'.repeat(1200) } }
    const invocationId = session.getPendingCalls()[0].invocationId
    await session.recordToolResult({ invocationId, rawResponse: response, modelResponse: response })
    expect(storeArtifact).toHaveBeenCalledTimes(2)
    const encryptedState = save.mock.calls.at(-1)![0].input.encryptedState
    open.mockResolvedValue({ memoryId: 'memory-1', turnId: 'turn-1', revision: 2, encryptedState })
    const restored = (await openAgentTurnSession(input()))!
    const replayed = (await restored.getReplayResult(invocationId))!
    expect(replayed.rawResponse).toEqual(response)
    expect(JSON.stringify(replayed.modelResponse).length).toBeLessThan(8500)
    expect(JSON.stringify(replayed.modelResponse)).not.toContain('execution/workspace-1')
    expect(replayed.modelResponse.output.memoryArtifact).toEqual({
      id: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
  })
})
