/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({ env: { ENCRYPTION_KEY: 'ab'.repeat(32) } }))
vi.mock('@/providers/conversation-history', () => ({
  getConfiguredConversationToolBinding: vi.fn(),
}))
vi.mock('@/providers/runtime-context', () => ({ executeProviderTool: vi.fn() }))
vi.mock('@/providers/utils', () => ({ prepareToolExecution: vi.fn() }))
vi.mock('@/providers/models', () => ({
  PROVIDER_DEFINITIONS: { openai: { models: [{ id: 'model-a', contextWindow: 1000 }] } },
  getMaxOutputTokensForModel: vi.fn().mockReturnValue(4096),
}))
vi.mock('@/lib/tokenization/accurate', () => ({
  getAccurateTokenCount: (text: string) => text.length,
}))

import { encryptMemoryCheckpoint } from '@/lib/memory/checkpoint-codec'
import { renderConversationExecutionRecord } from '@/lib/memory/execution-record'
import { AgentTurnStateMachine } from '@/lib/memory/turn-state'
import {
  budgetConversationMessages,
  continuePendingConversationCalls,
  restoreConversationNativeMessages,
} from '@/providers/conversation-continuation'
import { getConfiguredConversationToolBinding } from '@/providers/conversation-history'
import {
  getNativeConversationMessage,
  setEncryptedConversationMessage,
  setNativeConversationMessage,
} from '@/providers/conversation-metadata'
import { getMaxOutputTokensForModel } from '@/providers/models'
import { executeProviderTool } from '@/providers/runtime-context'
import type { Message, ProviderRequest } from '@/providers/types'
import { prepareToolExecution } from '@/providers/utils'

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

describe('durable conversation restoration and budgeting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('reserves the current user message before selecting complete tool exchanges', () => {
    const required: Message = { role: 'user', content: 'Complete my task' }
    const old: Message = { role: 'assistant', content: 'x'.repeat(600) }
    const group = toolGroup('recent result')
    expect(budgetConversationMessages(request, [old, required, ...group], [required])).toEqual([
      required,
      ...group,
    ])
  })

  it.each([undefined, 'high'] as const)(
    'reserves provider output headroom with thinking %s',
    (thinkingLevel) => {
      vi.mocked(getMaxOutputTokensForModel).mockReturnValueOnce(700)
      const required: Message = { role: 'user', content: 'Complete my task' }
      const old: Message = { role: 'assistant', content: 'x'.repeat(300) }
      expect(
        budgetConversationMessages(
          { ...request, maxTokens: thinkingLevel ? 100 : undefined, thinkingLevel },
          [old, required],
          [required]
        )
      ).toEqual([required])
    }
  )

  it('counts opaque native reasoning and replaces an oversized newest batch with bounded progress', () => {
    const required: Message = { role: 'user', content: 'Complete my task' }
    const group = toolGroup()
    setNativeConversationMessage(group[0], {
      protocol: 'responses',
      providerId: 'openai',
      model: 'model-a',
      binding: 'binding-a',
      value: [{ type: 'reasoning', encrypted_content: 'private-signature'.repeat(1000) }],
    })
    const selected = budgetConversationMessages(request, [required, ...group], [required])
    expect(selected[0]).toBe(required)
    expect(selected).toHaveLength(2)
    expect(selected[1].role).toBe('user')
    expect(selected[1].content).toContain('recorded outcomes')
    expect(JSON.stringify(selected)).not.toContain('private-signature')
    expect(JSON.stringify(selected).length).toBeLessThan(800)
  })

  it('does not admit a full oversized batch when no history group has been selected yet', () => {
    const group = toolGroup('x'.repeat(5000))
    const selected = budgetConversationMessages(request, group)
    expect(JSON.stringify(selected).length).toBeLessThan(800)
    expect(selected[0].content).toContain('recorded outcomes')
    expect(selected.some((message) => message.role === 'tool')).toBe(false)
  })

  it('shortens an existing portable record without wrapping it in a second execution record', () => {
    const required: Message = { role: 'user', content: 'Complete my task' }
    const receipt = renderConversationExecutionRecord(toolGroup('x'.repeat(5000)))
    const selected = budgetConversationMessages(request, [required, receipt], [required])
    expect(selected).toHaveLength(2)
    expect(selected[1].content).toMatch(/^\{"type":"untrusted_prior_tool_execution"/)
    expect(selected[1].content?.match(/untrusted_prior_tool_execution/g)).toHaveLength(1)
  })

  it('does not describe ordinary assistant text as a completed tool execution', () => {
    const required: Message = { role: 'user', content: 'Complete my task' }
    const assistant: Message = { role: 'assistant', content: 'x'.repeat(5000) }
    const selected = budgetConversationMessages(request, [required, assistant], [required])
    expect(selected[1].role).toBe('assistant')
    expect(selected[1].content).not.toContain('tool')
  })

  it('preserves an already oversized required input and does not add history on top of it', () => {
    const required: Message = { role: 'user', content: 'x'.repeat(1500) }
    expect(budgetConversationMessages(request, [required, ...toolGroup()], [required])).toEqual([
      required,
    ])
  })
})
