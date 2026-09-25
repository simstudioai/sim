import { describe, expect, it, vi } from 'vitest'
import { getConversationModelLimits } from '@/providers/conversation-model'

vi.mock('@/providers/models', () => ({
  PROVIDER_DEFINITIONS: {
    test: {
      models: [
        { id: 'gpt-test', contextWindow: 128_000 },
        { id: 'claude-sonnet-test', contextWindow: 200_000 },
        { id: 'claude-sonnet-test-20250514', contextWindow: 100_000 },
        { id: 'bedrock/anthropic.test-model-v1:0', contextWindow: 200_000 },
      ],
    },
  },
  getMaxOutputTokensForModel: (model: string) => (model === 'gpt-test' ? 16_000 : 4096),
}))

describe('conversation model capacity', () => {
  it('uses the known base capacity and output reserve for dated model variants', () => {
    expect(getConversationModelLimits('GPT-test-2026-08-01')).toEqual({
      contextWindow: 128_000,
      outputTokens: 16_000,
    })
  })

  it.each(['us', 'us-gov', 'global', 'eu', 'apac'])(
    'normalizes known Bedrock %s profile models',
    (region) => {
      expect(
        getConversationModelLimits(`bedrock/${region}.anthropic.test-model-v1:0`).contextWindow
      ).toBe(200_000)
    }
  )

  it('resolves compact dated model IDs while preferring an exact catalog entry', () => {
    expect(getConversationModelLimits('claude-sonnet-test-20250929').contextWindow).toBe(200_000)
    expect(getConversationModelLimits('claude-sonnet-test-20250514').contextWindow).toBe(100_000)
    expect(getConversationModelLimits('claude-sonnet-test-preview').contextWindow).toBe(32_000)
  })

  it('keeps unknown deployment capabilities conservative', () => {
    expect(getConversationModelLimits('azure/my-deployment').contextWindow).toBe(32_000)
  })
})
