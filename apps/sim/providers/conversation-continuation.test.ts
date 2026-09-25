import { resetEnvMock, setEnv } from '@sim/testing/mocks/env.mock'
import { providersConversationHistoryMock } from '@sim/testing/mocks/providers-conversation-history.mock'
import { providersUtilsMock } from '@sim/testing/mocks/providers-utils.mock'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/providers/conversation-history', () => providersConversationHistoryMock)
vi.mock('@/providers/runtime-context', () => ({ executeProviderTool: vi.fn() }))
vi.mock('@/providers/utils', () => providersUtilsMock)

import { encryptMemoryCheckpoint } from '@/lib/memory/checkpoint-codec'
import { AgentTurnStateMachine } from '@/lib/memory/turn-state'
import {
  continuePendingConversationCalls,
  groupConversationMessages,
  restoreConversationNativeMessages,
} from '@/providers/conversation-continuation'
import { getConfiguredConversationToolBinding } from '@/providers/conversation-history'
import {
  getNativeConversationMessage,
  setEncryptedConversationMessage,
} from '@/providers/conversation-metadata'
import { executeProviderTool } from '@/providers/runtime-context'
import type { Message, ProviderRequest } from '@/providers/types'
import { prepareToolExecution } from '@/providers/utils'

setEnv({ ENCRYPTION_KEY: 'ab'.repeat(32), AZURE_OPENAI_ENDPOINT: undefined })
afterAll(resetEnvMock)

const request: ProviderRequest = { model: 'model-a', apiKey: '', maxTokens: 100 }

function toolGroup(content = 'result'): Message[] {
  return [
    {
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'call-1', type: 'function', function: { name: 'search', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'call-1', name: 'search', content },
  ]
}

describe('durable conversation restoration and continuation', () => {
  beforeEach(() => {
    vi.mocked(prepareToolExecution).mockReturnValue({ executionParams: {}, toolParams: {} })
    vi.mocked(getConfiguredConversationToolBinding).mockReturnValue('configured-binding')
  })

  async function pendingSession(
    { configuredToolBinding }: { configuredToolBinding?: string } = {
      configuredToolBinding: getConfiguredConversationToolBinding(toolRequest.tools![0]),
    }
  ) {
    const session = new AgentTurnStateMachine({ save: async () => {} })
    await session.captureStep({
      assistant: { role: 'assistant', content: '' },
      calls: [
        { providerCallId: 'call-1', toolId: 'search', arguments: '{}', configuredToolBinding },
      ],
      native: {
        protocol: 'responses',
        providerId: 'openai',
        model: 'model-a',
        binding: 'binding-a',
        value: [],
      },
    })
    return session
  }

  const toolRequest: ProviderRequest = {
    ...request,
    tools: [
      {
        id: 'search',
        description: '',
        params: {},
        parameters: { type: 'object', properties: {}, required: [] },
      },
    ],
  }

  it('excludes incomplete and mismatched batches without fabricating historical outcomes', () => {
    const input: Message = { role: 'user', content: 'original input' }
    const final: Message = { role: 'assistant', content: 'completed response' }
    const incomplete = toolGroup().slice(0, 1)
    const mismatched = toolGroup()
    mismatched[1].tool_call_id = 'unknown-call'
    const complete = toolGroup('recorded terminal result')
    expect(
      groupConversationMessages([input, ...incomplete, ...mismatched, ...complete, final])
    ).toEqual([[input], complete, [final]])
  })

  it('records a known tool failure instead of repeatedly dispatching it on every continuation', async () => {
    const session = await pendingSession()
    vi.mocked(executeProviderTool).mockRejectedValueOnce(new Error('upstream unavailable'))
    await continuePendingConversationCalls(toolRequest, session)
    expect(session.getPendingCalls()).toEqual([])
    expect(session.getMessages('openai', 'model-a', 'binding-a')[1].content).toContain(
      'upstream unavailable'
    )
    await continuePendingConversationCalls(toolRequest, session)
    expect(executeProviderTool).toHaveBeenCalledOnce()
  })

  it('never dispatches a pending call whose recorded configuration cannot be verified', async () => {
    for (const configuredToolBinding of [undefined, 'obsolete-binding']) {
      const session = await pendingSession({ configuredToolBinding })
      await continuePendingConversationCalls(toolRequest, session)
      expect(session.getPendingCalls()).toEqual([])
      expect(session.getMessages('openai', 'model-a', 'binding-a')[1].content).toContain(
        'configuration could not be verified'
      )
    }
    expect(prepareToolExecution).not.toHaveBeenCalled()
    expect(executeProviderTool).not.toHaveBeenCalled()
  })

  it('propagates cancellation, nonretryable refusal, and preparation refusal unchanged', async () => {
    for (const error of [
      new DOMException('aborted', 'AbortError'),
      Object.assign(new Error('refused'), { retryable: false }),
    ]) {
      const session = await pendingSession()
      vi.mocked(executeProviderTool).mockRejectedValueOnce(error)
      await expect(continuePendingConversationCalls(toolRequest, session)).rejects.toBe(error)
      expect(session.getPendingCalls()).toHaveLength(1)
    }
    const refused = new Error('Secret projection refused')
    vi.mocked(prepareToolExecution).mockImplementationOnce(() => {
      throw refused
    })
    await expect(
      continuePendingConversationCalls(toolRequest, await pendingSession())
    ).rejects.toBe(refused)
  })

  it('clears a previously restored native message when the next fallback binding changes', async () => {
    const messages = toolGroup()
    const native = {
      protocol: 'responses',
      providerId: 'openai',
      model: 'model-a',
      binding: 'binding-a',
      value: [{ type: 'reasoning', encrypted_content: 'private-signature' }],
    } as const
    setEncryptedConversationMessage(
      messages[0],
      await encryptMemoryCheckpoint({ memoryId: 'memory-1', native })
    )
    await restoreConversationNativeMessages(messages, 'openai', 'model-a', 'binding-a', 'memory-1')
    expect(getNativeConversationMessage(messages[0], 'responses')).toEqual(native.value)
    await restoreConversationNativeMessages(messages, 'openai', 'model-b', 'binding-a', 'memory-1')
    expect(getNativeConversationMessage(messages[0], 'responses')).toBeUndefined()
    expect(JSON.stringify(messages)).not.toContain('private-signature')
  })

  it.each(['anthropic', 'azure-anthropic', 'bedrock', 'google', 'vertex', 'deepseek'] as const)(
    'projects foreign tool history for %s without inventing required reasoning state',
    async (providerId) => {
      const restored = await restoreConversationNativeMessages(
        toolGroup(),
        providerId,
        'model-a',
        'binding-a'
      )
      expect(restored).toHaveLength(1)
      expect(restored[0].role).toBe('user')
      expect(restored[0].content).toContain('untrusted_prior_tool_execution')
      expect(restored[0].content).toContain('result')
    }
  )

  it('bounds incompatible provider history without modifying the recorded arguments or outcomes', async () => {
    const messages = toolGroup('retained result '.repeat(1000))
    messages[0].tool_calls![0].function.arguments = JSON.stringify({
      value: 'original argument '.repeat(1000),
    })
    const original = structuredClone(messages)
    const restored = await restoreConversationNativeMessages(
      messages,
      'anthropic',
      'model-a',
      'binding-a'
    )
    expect(restored).toHaveLength(1)
    expect(restored[0].content!.length).toBeLessThanOrEqual(4096)
    expect(restored[0].content).toContain('execution record shortened')
    expect(messages).toEqual(original)
  })

  it('applies the same compatibility policy to current invocation and persisted exchanges', async () => {
    const session = await pendingSession()
    const call = session.getPendingCalls()[0]
    const response = { success: true, output: { value: 'recorded outcome' } }
    await session.recordToolResult({
      invocationId: call.invocationId,
      rawResponse: response,
      modelResponse: response,
    })
    const current = session.getMessages('anthropic', 'other-model', 'other-binding')
    expect(current).toHaveLength(2)
    const persisted = structuredClone(current)
    expect(
      await restoreConversationNativeMessages(current, 'anthropic', 'other-model', 'other-binding')
    ).toEqual(
      await restoreConversationNativeMessages(
        persisted,
        'anthropic',
        'other-model',
        'other-binding'
      )
    )
  })

  it.each([
    { endpoint: 'https://azure.test', protocol: 'responses' as const },
    { endpoint: 'https://azure.test/openai/v1/responses', protocol: 'responses' as const },
    {
      endpoint: 'https://azure.test/openai/deployments/model/chat/completions',
      protocol: 'chat-completions' as const,
    },
  ])('uses Azure endpoint protocol $protocol for $endpoint', async ({ endpoint, protocol }) => {
    const messages = toolGroup()
    const native = {
      protocol,
      providerId: 'azure-openai' as const,
      model: 'model-a',
      binding: 'binding-a',
      value: { private: 'continuation' },
    }
    setEncryptedConversationMessage(
      messages[0],
      await encryptMemoryCheckpoint({ memoryId: 'memory-1', native })
    )
    await restoreConversationNativeMessages(
      messages,
      'azure-openai',
      'model-a',
      'binding-a',
      'memory-1',
      { azureEndpoint: endpoint }
    )
    expect(getNativeConversationMessage(messages[0], protocol)).toEqual(native.value)
  })
})
