import { describe, expect, it } from 'vitest'
import { ElevenLabsBlock } from '@/blocks/blocks/elevenlabs'

describe('ElevenLabs agent tool calls', () => {
  it('keeps the model voice settings for Edit Voice Settings', () => {
    const mapper = ElevenLabsBlock.tools.config?.params
    if (!mapper) throw new Error('ElevenLabs block has no params mapper')

    const result = mapper(
      { apiKey: 'key', voiceId: 'voice-1', stability: 0.4, style: 0.2, speed: 1.1 },
      { operation: 'edit_voice_settings' }
    )

    expect(result).toMatchObject({ stability: 0.4, style: 0.2, speed: 1.1 })
  })
})
