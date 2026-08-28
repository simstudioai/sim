/**
 * @vitest-environment node
 */
import { createExecutionContext } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const operations = vi.hoisted(() => ({
  executeAzureTts: vi.fn(),
  executeCartesiaTts: vi.fn(),
  executeDeepgramTts: vi.fn(),
  executeElevenLabsTts: vi.fn(),
  executeGoogleTts: vi.fn(),
  executeLegacyElevenLabsTts: vi.fn(),
  executeOpenAiTts: vi.fn(),
  executePlayHtTts: vi.fn(),
}))

vi.mock('@/lib/internal/tts/operations', () => operations)

import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'
import { TtsOperationError } from '@/lib/internal/tts/errors'
import { executeTtsTool } from '@/lib/internal/tts/execute-tool'

function request(overrides: Partial<InternalToolOperationCall> = {}): InternalToolOperationCall {
  return {
    toolId: 'tts_openai',
    input: { text: 'Hello', apiKey: 'key' },
    headers: new Headers(),
    context: {
      ...createExecutionContext({ workflowId: 'workflow-1' }),
      workspaceId: 'workspace-1',
      executionId: 'execution-1',
      userId: 'user-1',
    },
    requestId: 'request-1',
    ...overrides,
  } as InternalToolOperationCall
}

const CASES = [
  [
    'elevenlabs_tts',
    { text: 'Hello', apiKey: 'key', voiceId: 'voice_1' },
    operations.executeLegacyElevenLabsTts,
  ],
  ['tts_openai', { text: 'Hello', apiKey: 'key' }, operations.executeOpenAiTts],
  ['tts_deepgram', { text: 'Hello', apiKey: 'key' }, operations.executeDeepgramTts],
  [
    'tts_elevenlabs',
    { text: 'Hello', apiKey: 'key', voiceId: 'voice_1' },
    operations.executeElevenLabsTts,
  ],
  ['tts_cartesia', { text: 'Hello', apiKey: 'key' }, operations.executeCartesiaTts],
  ['tts_google', { text: 'Hello', apiKey: 'key' }, operations.executeGoogleTts],
  ['tts_azure', { text: 'Hello', apiKey: 'key' }, operations.executeAzureTts],
  [
    'tts_playht',
    { text: 'Hello', apiKey: 'key', userId: 'playht-user' },
    operations.executePlayHtTts,
  ],
] as const

describe('executeTtsTool', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(CASES)(
    'dispatches %s with trusted scope and cancellation',
    async (toolId, input, operation) => {
      const controller = new AbortController()
      operation.mockResolvedValue({ audioUrl: 'https://audio.example/file.mp3' })

      const response = await executeTtsTool(request({ toolId, input, signal: controller.signal }))

      expect(response.status).toBe(200)
      expect(operation).toHaveBeenCalledWith(input, {
        requestId: 'request-1',
        signal: controller.signal,
        userId: 'user-1',
        workspaceId: 'workspace-1',
        workflowId: 'workflow-1',
        executionId: 'execution-1',
      })
    }
  )

  it('authenticates before validating provider input', async () => {
    const response = await executeTtsTool(
      request({
        input: null,
        context: createExecutionContext({ workflowId: 'workflow-1' }),
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(operations.executeOpenAiTts).not.toHaveBeenCalled()
  })

  it('preserves unified provider-specific required errors', async () => {
    const elevenLabs = await executeTtsTool(
      request({ toolId: 'tts_elevenlabs', input: { text: 'Hello', apiKey: 'key' } })
    )
    expect(elevenLabs.status).toBe(400)
    await expect(elevenLabs.json()).resolves.toEqual({
      error: 'voiceId is required for ElevenLabs provider',
    })

    const playHt = await executeTtsTool(
      request({ toolId: 'tts_playht', input: { text: 'Hello', apiKey: 'key' } })
    )
    expect(playHt.status).toBe(400)
    await expect(playHt.json()).resolves.toEqual({
      error: 'userId is required for PlayHT provider',
    })
  })

  it('preserves unified contract validation details for common required fields', async () => {
    const response = await executeTtsTool(request({ input: {} }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Missing required fields: provider, text, and apiKey',
      details: expect.any(Array),
    })
  })

  it('preserves legacy validation and provider status envelopes', async () => {
    const invalid = await executeTtsTool(
      request({ toolId: 'elevenlabs_tts', input: { text: 'Hello', apiKey: 'key' } })
    )
    expect(invalid.status).toBe(400)
    await expect(invalid.json()).resolves.toEqual({ error: 'Missing required parameters' })

    operations.executeLegacyElevenLabsTts.mockRejectedValue(
      new TtsOperationError('Failed to generate TTS: 429 Too Many Requests', 429)
    )
    const limited = await executeTtsTool(
      request({
        toolId: 'elevenlabs_tts',
        input: { text: 'Hello', apiKey: 'key', voiceId: 'voice_1' },
      })
    )
    expect(limited.status).toBe(429)
    await expect(limited.json()).resolves.toEqual({
      error: 'Failed to generate TTS: 429 Too Many Requests',
    })
  })

  it('stops before provider work after cancellation', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(executeTtsTool(request({ signal: controller.signal }))).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(operations.executeOpenAiTts).not.toHaveBeenCalled()
  })
})
