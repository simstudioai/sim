import { describe, expect, it } from 'vitest'
import { TtsBlock } from '@/blocks/blocks/tts'

function elevenLabsParams(voice: Record<string, unknown>) {
  const mapParams = TtsBlock.tools.config?.params
  if (!mapParams) throw new Error('TTS block has no params mapper')
  return mapParams({ provider: 'elevenlabs', text: 'Hi', apiKey: 'key', voiceId: 'v', ...voice })
}

describe('TtsBlock ElevenLabs voice settings', () => {
  it('sends a zero slider value instead of dropping it', () => {
    expect(elevenLabsParams({ stability: 0, similarityBoost: 0, style: 0 })).toMatchObject({
      stability: 0,
      similarityBoost: 0,
      style: 0,
    })
  })

  it('reads the text form older workflows store and leaves blank settings unset', () => {
    const params = elevenLabsParams({ stability: '0.5', similarityBoost: '', style: '0' })
    expect(params).toMatchObject({ stability: 0.5, style: 0 })
    expect(params.similarityBoost).toBeUndefined()
  })
})
