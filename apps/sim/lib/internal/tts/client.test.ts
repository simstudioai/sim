import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_TTS_TEXT_BYTES, synthesizeGoogle, synthesizeOpenAi } from '@/lib/internal/tts/client'

const fetchMock = vi.fn<typeof fetch>()

describe('TTS provider client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('bounds and decodes Google base64 JSON responses', async () => {
    fetchMock.mockResolvedValue(
      Response.json({ audioContent: Buffer.from('google-audio').toString('base64') })
    )

    const result = await synthesizeGoogle({
      text: 'Hello',
      apiKey: 'google-key',
      languageCode: 'en-US',
      audioEncoding: 'OGG_OPUS',
    })

    expect(result.audioBuffer).toEqual(Buffer.from('google-audio'))
    expect(result).toMatchObject({ format: 'oggopus', mimeType: 'audio/mpeg' })
  })

  it('rejects oversized text before serializing or contacting a provider', async () => {
    await expect(
      synthesizeOpenAi({ text: 'x'.repeat(MAX_TTS_TEXT_BYTES + 1), apiKey: 'key' })
    ).rejects.toThrow(/TTS text exceeds maximum size/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
