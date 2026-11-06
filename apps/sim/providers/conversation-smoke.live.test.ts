import { toolsMock, toolsMockFns } from '@sim/testing/mocks/tools.mock'
import { isRecordLike } from '@sim/utils/object'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/tools', () => toolsMock)

import type { ConversationProtocol } from '@/lib/memory/conversation-types'
import { AgentTurnStateMachine } from '@/lib/memory/turn-state'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import {
  bindConversationRequestContext,
  getConversationBinding,
} from '@/providers/conversation-history'
import { providerHistoryAdapters, providerHistoryProtocols } from '@/providers/history-adapters'
import { getProviderExecutor } from '@/providers/registry'
import { runWithProviderRuntimeContext } from '@/providers/runtime-context'
import type { ProviderId, ProviderRequest } from '@/providers/types'

toolsMockFns.mockExecuteTool.mockImplementation(async () => ({
  success: true,
  output: { value: 'memory-smoke-ok' },
}))

const enabled = process.env.RUN_AGENT_MEMORY_PROVIDER_SMOKE === 'true'

/** Live calls require an explicit gate and operator-supplied models/credentials; CI never spends by default. */
describe.skipIf(!enabled)('live durable provider history contracts', () => {
  for (const protocol of Object.keys(providerHistoryAdapters) as ConversationProtocol[]) {
    it(protocol, async () => {
      const configured: unknown = JSON.parse(process.env.AGENT_MEMORY_PROVIDER_SMOKE_CASES ?? '[]')
      if (!Array.isArray(configured)) throw new Error('Provider smoke cases must be an array')
      const entry = configured.find(
        (candidate) => isRecordLike(candidate) && candidate.protocol === protocol
      )
      if (
        !isRecordLike(entry) ||
        typeof entry.providerId !== 'string' ||
        !(entry.providerId in providerHistoryProtocols) ||
        typeof entry.model !== 'string'
      )
        throw new Error(`Missing smoke configuration for ${protocol}`)
      const providerId = entry.providerId as ProviderId
      const session = new AgentTurnStateMachine({ save: async () => {} })
      const credential = (key: string) => (typeof entry[key] === 'string' ? entry[key] : undefined)
      const request: ProviderRequest = {
        model: entry.model,
        apiKey: credential('apiKey'),
        azureEndpoint: credential('azureEndpoint'),
        azureApiVersion: credential('azureApiVersion'),
        bedrockAccessKeyId: credential('bedrockAccessKeyId'),
        bedrockSecretKey: credential('bedrockSecretKey'),
        bedrockRegion: credential('bedrockRegion'),
        maxTokens: 512,
        workflowId: 'memory-smoke',
        executionId: 'memory-smoke',
        blockId: 'agent',
        messages: [
          {
            role: 'user',
            content:
              'Call memory_echo once with value memory-smoke-ok. Then repeat the tool result exactly.',
          },
        ],
        tools: [
          {
            id: 'memory_echo',
            description: 'Returns the supplied text.',
            params: {},
            parameters: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value'],
            },
          },
        ],
        resolveToolInvocationId: (id, tool) => session.resolveInvocationId(id, tool),
      }
      const context = {
        agentConversation: session,
        resolvedSecretTraceRegistry: new ResolvedSecretTraceRegistry(),
        conversationProvider: { providerId, binding: getConversationBinding(providerId, request) },
      }
      bindConversationRequestContext(request, context)
      const provider = await getProviderExecutor(providerId)
      const response = await runWithProviderRuntimeContext(context, () =>
        provider.executeRequest(request)
      )
      expect(response).toHaveProperty('content')
      expect(session.getPendingCalls()).toEqual([])
      expect(
        session
          .getMessages(providerId, request.model, context.conversationProvider.binding)
          .some((message) => message.role === 'tool')
      ).toBe(true)
      const replay: ProviderRequest = {
        ...request,
        messages: [
          ...(request.messages ?? []),
          ...session.getMessages(providerId, request.model, context.conversationProvider.binding),
          {
            role: 'user',
            content:
              'Using the prior recorded result, reply memory-smoke-ok without another tool call.',
          },
        ],
      }
      bindConversationRequestContext(replay, context)
      const replayed = await runWithProviderRuntimeContext(context, () =>
        provider.executeRequest(replay)
      )
      expect(replayed).toHaveProperty('content')
    }, 90_000)
  }
})
