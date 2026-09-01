/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_TTS_AUDIO_BYTES,
  MAX_TTS_TEXT_BYTES,
  synthesizeDeepgram,
  synthesizeGoogle,
  synthesizeLegacyElevenLabs,
  synthesizeOpenAi,
} from '@/lib/internal/tts/client'
import { TtsOperationError } from '@/lib/internal/tts/errors'

const fetchMock = vi.fn<typeof fetch>()

describe('TTS provider client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => vi.unstubAllGlobals())

  it('forwards cancellation and clamps OpenAI speech speed', async () => {
    const controller = new AbortController()
    fetchMock.mockResolvedValue(new Response(Buffer.from('audio')))

    const result = await synthesizeOpenAi(
      {
        text: 'Hello',
        apiKey: 'openai-key',
        model: 'tts-1-hd',
        voice: 'coral',
        responseFormat: 'wav',
        speed: 9,
      },
      controller.signal
    )

    expect(result).toMatchObject({ format: 'wav', mimeType: 'audio/wav' })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/speech',
      expect.objectContaining({ signal: controller.signal })
    )
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    expect(body).toEqual({
      model: 'tts-1-hd',
      voice: 'coral',
      input: 'Hello',
      response_format: 'wav',
      speed: 4,
    })
  })

  it('uses the configured Deepgram model and container query', async () => {
    fetchMock.mockResolvedValue(new Response(Buffer.from('audio')))

    const result = await synthesizeDeepgram({
      text: 'Hello',
      apiKey: 'deepgram-key',
      model: 'aura-2-luna-en',
      encoding: 'linear16',
      sampleRate: 24000,
      container: 'wav',
    })

    expect(result.format).toBe('wav')
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://api.deepgram.com/v1/speak?model=aura-2-luna-en&encoding=linear16&sample_rate=24000&container=wav'
    )
  })

  it('bounds provider audio before materializing it', async () => {
    fetchMock.mockResolvedValue(
      new Response(Buffer.from('audio'), {
        headers: { 'Content-Length': String(MAX_TTS_AUDIO_BYTES + 1) },
      })
    )

    await expect(synthesizeOpenAi({ text: 'Hello', apiKey: 'key' })).rejects.toThrow(
      /exceeds maximum size/i
    )
  })

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

  it('preserves legacy ElevenLabs provider status errors', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 429, statusText: 'Too Many Requests' })
    )

    await expect(
      synthesizeLegacyElevenLabs({
        text: 'Hello',
        apiKey: 'elevenlabs-key',
        voiceId: 'voice_1',
      })
    ).rejects.toEqual(new TtsOperationError('Failed to generate TTS: 429 Too Many Requests', 429))
  })

  it('does not start a provider request when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      synthesizeOpenAi({ text: 'Hello', apiKey: 'key' }, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects oversized text before serializing or contacting a provider', async () => {
    await expect(
      synthesizeOpenAi({ text: 'x'.repeat(MAX_TTS_TEXT_BYTES + 1), apiKey: 'key' })
    ).rejects.toThrow(/TTS text exceeds maximum size/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
