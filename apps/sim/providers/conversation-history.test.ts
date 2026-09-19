/** @vitest-environment node */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({ env: {} }))
vi.mock('@/lib/core/utils/urls', () => ({ getOllamaUrl: () => 'http://localhost:11434' }))
vi.mock('@/providers/runtime-context', () => ({ getProviderRuntimeContext: vi.fn() }))

import { AgentTurnStateMachine } from '@/lib/memory/turn-state'
import {
  bindConversationRequestContext,
  captureProviderConversationStep,
  getConversationBinding,
} from '@/providers/conversation-history'
import { getProviderRuntimeContext } from '@/providers/runtime-context'
import type { ProviderRequest } from '@/providers/types'

describe('native history request binding', () => {
  const request: ProviderRequest = {
    model: 'model-a',
    apiKey: 'private-test-account',
    messages: [{ role: 'system', content: 'original instructions' }],
  }

  it('binds message-level system instructions as well as the system prompt', () => {
    const initial = getConversationBinding('bedrock', request)
    expect(
      getConversationBinding('bedrock', {
        ...request,
        messages: [{ role: 'system', content: 'changed instructions' }],
      })
    ).not.toBe(initial)
    expect(getConversationBinding('bedrock', { ...request, systemPrompt: 'changed' })).not.toBe(
      initial
    )
  })

  it('binds accounts and endpoints without retaining credentials in the digest', () => {
    const initial = getConversationBinding('azure-openai', request)
    expect(initial).toMatch(/^[a-f0-9]{64}$/)
    expect(
      getConversationBinding('azure-openai', { ...request, apiKey: 'another-account' })
    ).not.toBe(initial)
    expect(
      getConversationBinding('azure-openai', { ...request, azureEndpoint: 'https://other.example' })
    ).not.toBe(initial)
  })

  it('keeps deferred callbacks with the bound invocation when another ambient context is active', async () => {
    const owner = new AgentTurnStateMachine({ save: async () => {} })
    const other = new AgentTurnStateMachine({ save: async () => {} })
    const boundRequest = { ...request }
    bindConversationRequestContext(boundRequest, {
      agentConversation: owner,
      conversationProvider: { providerId: 'openai', binding: 'original-binding' },
    })
    vi.mocked(getProviderRuntimeContext).mockReturnValue({
      agentConversation: other,
      conversationProvider: { providerId: 'openai', binding: 'unrelated-binding' },
    })
    await captureProviderConversationStep(boundRequest, 'chat-completions', {
      content: 'owned answer',
    })
    expect(owner.getFinalAssistantContent()).toBe('owned answer')
    expect(other.getFinalAssistantContent()).toBeUndefined()
  })
})
