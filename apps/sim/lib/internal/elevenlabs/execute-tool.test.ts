/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operations = vi.hoisted(() => ({
  executeElevenLabsAudioIsolation: vi.fn(),
  executeElevenLabsSoundEffects: vi.fn(),
  executeElevenLabsSpeechToSpeech: vi.fn(),
}))

vi.mock('@/lib/internal/elevenlabs/operations', () => operations)

import { DEFAULT_MAX_JSON_BODY_BYTES } from '@/lib/api/server/validation'
import { ElevenLabsOperationError } from '@/lib/internal/elevenlabs/errors'
import { executeElevenLabsTool } from '@/lib/internal/elevenlabs/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

function toolRequest(overrides: Partial<InternalToolOperationCall> = {}) {
  return {
    toolId: 'elevenlabs_sound_effects',
    input: { apiKey: 'secret', text: 'sound' },
    headers: new Headers(),
    context: { ...createExecutionContext({ workflowId: 'workflow-1' }), userId: 'user-1' },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

const CASES = [
  [
    'elevenlabs_sound_effects',
    { apiKey: 'secret', text: 'sound' },
    operations.executeElevenLabsSoundEffects,
  ],
  [
    'elevenlabs_speech_to_speech',
    { apiKey: 'secret', voiceId: 'voice-1' },
    operations.executeElevenLabsSpeechToSpeech,
  ],
  ['elevenlabs_audio_isolation', { apiKey: 'secret' }, operations.executeElevenLabsAudioIsolation],
] as const

describe('executeElevenLabsTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const [, , operation] of CASES) operation.mockResolvedValue({ audioUrl: '/audio.mp3' })
  })

  it.each(CASES)(
    'dispatches %s to the authoritative operation',
    async (toolId, input, operation) => {
      const response = await executeElevenLabsTool(toolRequest({ toolId, input }))

      expect(response.status).toBe(200)
      expect(operation).toHaveBeenCalledWith(
        input,
        expect.objectContaining({ requestId: 'request-1', userId: 'user-1' })
      )
    }
  )

  it('authenticates before parsing operation input', async () => {
    const response = await executeElevenLabsTool(
      toolRequest({
        input: null,
        context: createExecutionContext({ workflowId: 'workflow-1' }),
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(operations.executeElevenLabsSoundEffects).not.toHaveBeenCalled()
  })

  it('preserves the legacy required-field validation message', async () => {
    const response = await executeElevenLabsTool(toolRequest({ input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Missing required fields: operation and apiKey',
    })
  })

  it('preserves the route input byte ceiling', async () => {
    const response = await executeElevenLabsTool(
      toolRequest({ input: { apiKey: 'secret', text: 'x'.repeat(DEFAULT_MAX_JSON_BODY_BYTES) } })
    )

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      error: `Request body exceeds the maximum allowed size of ${DEFAULT_MAX_JSON_BODY_BYTES} bytes`,
    })
    expect(operations.executeElevenLabsSoundEffects).not.toHaveBeenCalled()
  })

  it('projects typed operation failures without changing the envelope', async () => {
    operations.executeElevenLabsSoundEffects.mockRejectedValueOnce(
      new ElevenLabsOperationError('text is required', 400)
    )

    const response = await executeElevenLabsTool(toolRequest())

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'text is required' })
  })
})
