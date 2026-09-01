/**
 * @vitest-environment node
 */
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { PRIVATE_MODEL_INPUT_PROVENANCE_HEADER } from '@/lib/execution/model-input-provenance'
import {
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'

const {
  mockIsInternalFileUrl,
  mockDownloadFileFromStorage,
  mockIsModelSafeWorkspaceFileKey,
  mockResolveInternalFileUrl,
} = vi.hoisted(() => ({
  mockIsInternalFileUrl: vi.fn(),
  mockDownloadFileFromStorage: vi.fn(),
  mockIsModelSafeWorkspaceFileKey: vi.fn(),
  mockResolveInternalFileUrl: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/uploads/utils/file-utils', () => ({
  extractStorageKey: vi.fn(() => 'storage-key'),
  isInternalFileUrl: mockIsInternalFileUrl,
  getMimeTypeFromExtension: vi.fn(() => 'application/octet-stream'),
}))
vi.mock('@/lib/uploads/utils/file-utils.server', () => ({
  downloadFileFromStorage: mockDownloadFileFromStorage,
  resolveInternalFileUrl: mockResolveInternalFileUrl,
}))
vi.mock('@/app/api/files/authorization', () => ({
  assertToolFileAccess: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/uploads/contexts/workspace/workspace-file-secret-provenance', () => ({
  isModelSafeWorkspaceFileKey: mockIsModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE:
    'File cannot be sent to a model because its secret provenance is unavailable',
}))
vi.mock('@/lib/audio/extractor', () => ({
  isVideoFile: vi.fn(() => false),
  extractAudioFromVideo: vi.fn(),
}))

import { extractAudioFromVideo, isVideoFile } from '@/lib/audio/extractor'
import { executeSttTool } from '@/lib/internal/stt/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const PINNED_IP = '93.184.216.34'

const baseBody = {
  provider: 'whisper',
  apiKey: 'test-api-key',
  audioUrl: 'https://example.com/audio.mp3',
}

function createSttRequest(
  input: Record<string, unknown>,
  headers = new Headers(),
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'stt_whisper',
    input,
    headers,
    context: {
      userId: 'user-1',
      workspaceId: 'workspace-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

function createVerifiedSttRequest(
  body: Record<string, unknown>,
  overrides: Partial<InternalToolOperationCall> = {}
) {
  return createSttRequest(
    {
      ...body,
      [RESOLVED_SECRET_PROVENANCE_FIELD]: {
        version: 1,
        complete: true,
        entries: [],
      },
    },
    new Headers({
      [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
    }),
    overrides
  )
}

function mockSecureFetchResponse(body: { ok?: boolean; contentType?: string }) {
  return {
    ok: body.ok ?? true,
    status: 200,
    statusText: '',
    headers: new Headers({ 'content-type': body.contentType ?? 'audio/mpeg' }),
    body: null,
    text: async () => '',
    json: async () => ({}),
    arrayBuffer: async () => new ArrayBuffer(8),
  }
}

describe('executeSttTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: PINNED_IP,
      originalHostname: 'example.com',
    })
    mockIsInternalFileUrl.mockReturnValue(false)
    mockIsModelSafeWorkspaceFileKey.mockResolvedValue(true)
    mockDownloadFileFromStorage.mockResolvedValue(Buffer.from('audio'))

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ text: 'hello world', language: 'en', duration: 1.2 }),
      })
    )
  })

  it('bounds the audioUrl download and rejects oversized responses cleanly', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockRejectedValueOnce(
      new PayloadSizeLimitError({
        label: 'response body',
        maxBytes: 100 * 1024 * 1024,
        observedBytes: 200 * 1024 * 1024,
      })
    )

    const response = await executeSttTool(createVerifiedSttRequest(baseBody))

    expect(response.status).toBe(413)
    const data = (await response.json()) as { error: string }
    expect(data.error).toMatch(/exceeds the maximum supported size/i)

    const call = inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0]
    expect(call[1]).toBe(PINNED_IP)
    expect(call[2]).toMatchObject({ maxResponseBytes: 100 * 1024 * 1024 })
  })

  it('transcribes a normal, well-under-cap audio download successfully', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({})
    )

    const response = await executeSttTool(createVerifiedSttRequest(baseBody))

    expect(response.status).toBe(200)
    const data = (await response.json()) as { transcript: string }
    expect(data.transcript).toBe('hello world')
  })

  it('forwards tool cancellation through video audio extraction', async () => {
    const controller = new AbortController()
    vi.mocked(isVideoFile).mockReturnValueOnce(true)
    vi.mocked(extractAudioFromVideo).mockResolvedValueOnce({
      buffer: Buffer.from('converted-audio'),
      duration: 1,
      format: 'mp3',
      size: 15,
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({ contentType: 'video/mp4' })
    )

    const response = await executeSttTool(
      createVerifiedSttRequest(baseBody, { signal: controller.signal })
    )

    expect(response.status).toBe(200)
    expect(extractAudioFromVideo).toHaveBeenCalledWith(
      expect.any(Buffer),
      'video/mp4',
      expect.objectContaining({ signal: controller.signal })
    )
  })

  it('rejects an authenticated but incomplete private provenance envelope before downloading', async () => {
    const response = await executeSttTool(
      createSttRequest(
        {
          ...baseBody,
          [RESOLVED_SECRET_PROVENANCE_FIELD]: {
            version: 1,
            complete: false,
            entries: [],
          },
        },
        new Headers({
          [PRIVATE_MODEL_INPUT_PROVENANCE_HEADER]: RESOLVED_SECRET_PROVENANCE_METADATA_V1,
        })
      )
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Model input provenance is unavailable' })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('accepts a verified empty private provenance envelope', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({})
    )

    const response = await executeSttTool(createVerifiedSttRequest(baseBody))

    expect(response.status).toBe(200)
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledOnce()
  })

  it('rejects a tracked unsafe workspace audio file before reading its bytes', async () => {
    mockIsModelSafeWorkspaceFileKey.mockResolvedValueOnce(false)

    const response = await executeSttTool(
      createVerifiedSttRequest({
        provider: 'whisper',
        apiKey: 'test-api-key',
        audioFile: {
          id: 'file-1',
          name: 'audio.mp3',
          size: 5,
          type: 'audio/mpeg',
          key: 'workspace/workspace-1/audio.mp3',
        },
      })
    )

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'File cannot be sent to a model because its secret provenance is unavailable',
    })
    expect(mockDownloadFileFromStorage).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('rejects a tracked unsafe internal audio URL after access resolution', async () => {
    mockIsInternalFileUrl.mockReturnValue(true)
    mockResolveInternalFileUrl.mockResolvedValueOnce({
      fileUrl: 'https://storage.example.com/signed-audio.mp3',
    })
    mockIsModelSafeWorkspaceFileKey.mockResolvedValueOnce(false)

    const response = await executeSttTool(
      createVerifiedSttRequest({
        ...baseBody,
        audioUrl: '/api/files/serve/workspace/workspace-1/audio.mp3',
      })
    )

    expect(response.status).toBe(400)
    expect(mockResolveInternalFileUrl).toHaveBeenCalledOnce()
    expect(mockIsModelSafeWorkspaceFileKey).toHaveBeenCalledWith('storage-key')
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires the trusted executor user before resolving audio', async () => {
    const response = await executeSttTool(
      createVerifiedSttRequest(baseBody, {
        context: { workspaceId: 'workspace-1', metadata: {} },
      })
    )

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('rejects unsupported STT tool IDs before doing work', async () => {
    const response = await executeSttTool(
      createVerifiedSttRequest(baseBody, { toolId: 'stt_unknown' })
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      success: false,
      error: 'Unsupported STT tool: stt_unknown',
    })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })

  it('propagates cancellation instead of converting it into a retryable tool error', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(
      executeSttTool(createVerifiedSttRequest(baseBody, { signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('preserves the Deepgram request and result contract', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({ contentType: 'audio/wav' })
    )
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          results: {
            channels: [
              {
                detected_language: 'en',
                alternatives: [
                  {
                    transcript: 'deepgram transcript',
                    confidence: 0.98,
                    words: [{ word: 'deepgram', start: 0, end: 0.5, confidence: 0.98, speaker: 1 }],
                  },
                ],
              },
            ],
          },
          metadata: { duration: 1.5 },
        }),
        { status: 200 }
      )
    )

    const response = await executeSttTool(
      createVerifiedSttRequest(
        {
          provider: 'deepgram',
          apiKey: 'deepgram-key',
          audioUrl: 'https://example.com/audio.wav',
          language: 'auto',
          timestamps: 'word',
          diarization: true,
        },
        { toolId: 'stt_deepgram' }
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      transcript: 'deepgram transcript',
      segments: [
        {
          text: 'deepgram',
          start: 0,
          end: 0.5,
          speaker: 'Speaker 1',
          confidence: 0.98,
        },
      ],
      language: 'en',
      duration: 1.5,
      confidence: 0.98,
    })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('detect_language=true')
    expect(String(url)).toContain('diarize=true')
    expect(init?.headers).toEqual({
      Authorization: 'Token deepgram-key',
      'Content-Type': 'audio/wav',
    })
  })

  it('preserves the ElevenLabs multipart contract', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({})
    )
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          text: 'eleven transcript',
          language_code: 'en',
          words: [{ type: 'word', text: 'eleven', start: 0, end: 0.4, speaker_id: 'A' }],
        }),
        { status: 200 }
      )
    )

    const response = await executeSttTool(
      createVerifiedSttRequest(
        {
          provider: 'elevenlabs',
          apiKey: 'eleven-key',
          audioUrl: 'https://example.com/audio.mp3',
          language: 'en',
          timestamps: 'sentence',
        },
        { toolId: 'stt_elevenlabs' }
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      transcript: 'eleven transcript',
      segments: [{ text: 'eleven', start: 0, end: 0.4, speaker: 'A' }],
      language: 'en',
    })
    const [, init] = vi.mocked(fetch).mock.calls[0]
    expect(init?.headers).toEqual({ 'xi-api-key': 'eleven-key' })
    expect(init?.body).toBeInstanceOf(FormData)
    const form = init?.body as FormData
    expect(form.get('model_id')).toBe('scribe_v2')
    expect(form.get('language_code')).toBe('en')
    expect(form.get('timestamps_granularity')).toBe('word')
  })

  it('preserves AssemblyAI upload, feature flags, polling, and result fields', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({})
    )
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ upload_url: 'https://assembly.example/uploaded' }), {
          status: 200,
        })
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'transcript-1' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            status: 'completed',
            text: 'assembly transcript',
            language_code: 'en',
            audio_duration: 2,
            confidence: 0.91,
            words: [{ text: 'assembly', start: 0, end: 500, confidence: 0.91, speaker: 'A' }],
            sentiment_analysis_results: [{ sentiment: 'POSITIVE' }],
            entities: [{ entity_type: 'person_name', text: 'Ada' }],
            summary: 'Summary',
          }),
          { status: 200 }
        )
      )

    const response = await executeSttTool(
      createVerifiedSttRequest(
        {
          provider: 'assemblyai',
          apiKey: 'assembly-key',
          audioUrl: 'https://example.com/audio.mp3',
          model: 'universal',
          language: 'auto',
          timestamps: 'word',
          diarization: true,
          sentiment: true,
          entityDetection: true,
          piiRedaction: true,
          summarization: true,
        },
        { toolId: 'stt_assemblyai' }
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      transcript: 'assembly transcript',
      segments: [
        {
          text: 'assembly',
          start: 0,
          end: 0.5,
          speaker: 'Speaker A',
          confidence: 0.91,
        },
      ],
      language: 'en',
      duration: 2,
      confidence: 0.91,
      sentiment: [{ sentiment: 'POSITIVE' }],
      entities: [{ entity_type: 'person_name', text: 'Ada' }],
      summary: 'Summary',
    })
    const transcriptRequest = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))
    expect(transcriptRequest).toMatchObject({
      audio_url: 'https://assembly.example/uploaded',
      speech_model: 'universal',
      language_detection: true,
      speaker_labels: true,
      sentiment_analysis: true,
      entity_detection: true,
      redact_pii: true,
      summarization: true,
    })
  })

  it('preserves the Gemini inline-data payload and response contract', async () => {
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValueOnce(
      mockSecureFetchResponse({ contentType: 'audio/ogg' })
    )
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'gemini transcript' }] } }] }),
        { status: 200 }
      )
    )

    const response = await executeSttTool(
      createVerifiedSttRequest(
        {
          provider: 'gemini',
          apiKey: 'gemini-key',
          audioUrl: 'https://example.com/audio.ogg',
          language: 'fr',
          timestamps: 'sentence',
        },
        { toolId: 'stt_gemini' }
      )
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ transcript: 'gemini transcript', language: 'fr' })
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain('gemini-2.5-flash:generateContent?key=gemini-key')
    const requestBody = JSON.parse(String(init?.body))
    expect(requestBody.contents[0].parts[0].inline_data.mime_type).toBe('audio/ogg')
    expect(requestBody.contents[0].parts[1].text).toContain('The audio is in fr.')
    expect(requestBody.contents[0].parts[1].text).toContain('Include timestamps')
  })
})
