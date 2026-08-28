/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  generateElevenLabsAudio,
  MAX_ELEVENLABS_AUDIO_BYTES,
} from '@/lib/internal/elevenlabs/client'
import { ElevenLabsOperationError } from '@/lib/internal/elevenlabs/errors'

describe('ElevenLabs audio client', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('sends the exact sound generation payload and bounds the audio response', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
      })
    )

    await expect(
      generateElevenLabsAudio({
        operation: 'sound_effects',
        input: {
          apiKey: 'secret',
          text: 'A soft chime',
          modelId: 'eleven_text_to_sound_v2',
          durationSeconds: 2,
          promptInfluence: 0.4,
          loop: true,
        },
      })
    ).resolves.toEqual(Buffer.from([1, 2, 3]))

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.elevenlabs.io/v1/sound-generation')
    expect(init).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'audio/mpeg',
        'Content-Type': 'application/json',
        'xi-api-key': 'secret',
      },
      body: JSON.stringify({
        text: 'A soft chime',
        model_id: 'eleven_text_to_sound_v2',
        duration_seconds: 2,
        prompt_influence: 0.4,
        loop: true,
      }),
    })
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends source audio and speech conversion fields as multipart data', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([1]), { status: 200 }))

    await generateElevenLabsAudio({
      operation: 'speech_to_speech',
      input: {
        apiKey: 'secret',
        voiceId: 'voice-1',
        modelId: 'eleven_english_sts_v2',
        removeBackgroundNoise: true,
      },
      source: {
        buffer: Buffer.from('audio'),
        fileName: 'source.wav',
        mimeType: 'audio/wav',
      },
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.elevenlabs.io/v1/speech-to-speech/voice-1')
    const body = init?.body as FormData
    expect(body.get('model_id')).toBe('eleven_english_sts_v2')
    expect(body.get('remove_background_noise')).toBe('true')
    expect(body.get('audio')).toBeInstanceOf(File)
  })

  it('preserves provider status errors without materializing an unbounded body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('denied', { status: 401, statusText: 'Unauthorized' })
    )

    await expect(
      generateElevenLabsAudio({
        operation: 'sound_effects',
        input: { apiKey: 'bad', text: 'sound' },
      })
    ).rejects.toEqual(
      new ElevenLabsOperationError('ElevenLabs request failed: 401 Unauthorized', 401)
    )
  })

  it('preserves cancellation that occurs while draining a provider error', async () => {
    const controller = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(stream) {
            controller.abort(reason)
            stream.close()
          },
        }),
        { status: 500, statusText: 'Internal Server Error' }
      )
    )

    await expect(
      generateElevenLabsAudio(
        { operation: 'sound_effects', input: { apiKey: 'bad', text: 'sound' } },
        controller.signal
      )
    ).rejects.toBe(reason)
  })

  it('rejects oversized audio from content length before buffering it', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(new Uint8Array([1]), {
        status: 200,
        headers: { 'content-length': String(MAX_ELEVENLABS_AUDIO_BYTES + 1) },
      })
    )

    await expect(
      generateElevenLabsAudio({
        operation: 'sound_effects',
        input: { apiKey: 'secret', text: 'sound' },
      })
    ).rejects.toMatchObject({ name: 'PayloadSizeLimitError' })
  })

  it('does no provider work after cancellation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      generateElevenLabsAudio(
        { operation: 'sound_effects', input: { apiKey: 'secret', text: 'sound' } },
        controller.signal
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
