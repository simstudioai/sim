/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS,
  FALAI_IMAGE_FALLBACK_PROVIDER_COST_DOLLARS,
  FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS,
  getFalAICostMetadata,
} from './falai-pricing'

// Avoid the real inter-attempt backoff so the fallback path resolves instantly.
vi.mock('@sim/utils/helpers', () => ({ sleep: vi.fn().mockResolvedValue(undefined) }))

describe('getFalAICostMetadata fallback floor', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    // Both fal cost endpoints (billing-events + pricing estimate) fail, forcing
    // the provider-cost floor selection by endpoint category.
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => 'error',
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it.each([
    ['fal-ai/f5-tts', FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/gemini-3.1-flash-tts', FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/minimax-music/v2.6', FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/elevenlabs/sound-effects/v2', FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/nano-banana', FALAI_IMAGE_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/veo-3.1', FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS],
    ['fal-ai/seedance-2.0', FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS],
  ])('uses the correct provider-cost floor for %s', async (endpointId, expected) => {
    const result = await getFalAICostMetadata({
      apiKey: 'test-key',
      endpointId,
      requestId: 'req_123',
    })

    expect(result.source).toBe('fallback_floor')
    expect(result.costDollars).toBe(expected)
  })

  it('never bills an audio clip at the video floor', () => {
    expect(FALAI_AUDIO_FALLBACK_PROVIDER_COST_DOLLARS).toBeLessThan(
      FALAI_VIDEO_FALLBACK_PROVIDER_COST_DOLLARS
    )
  })
})
