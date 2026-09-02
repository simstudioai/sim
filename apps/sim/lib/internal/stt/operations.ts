import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { extractAudioFromVideo, isVideoFile } from '@/lib/audio/extractor'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import type { EgressProfile } from '@/lib/core/security/egress/profiles'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { validateOpaqueModelInputProvenance } from '@/lib/execution/model-input-provenance'
import type { SttOperationInput } from '@/lib/internal/stt/schema'
import {
  isModelSafeWorkspaceFileKey,
  MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE,
} from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import {
  extractStorageKey,
  getMimeTypeFromExtension,
  isInternalFileUrl,
} from '@/lib/uploads/utils/file-utils'
import {
  downloadFileFromStorage,
  resolveInternalFileUrl,
} from '@/lib/uploads/utils/file-utils.server'
import { MAX_FILE_SIZE } from '@/lib/uploads/utils/validation'
import { assertToolFileAccess } from '@/app/api/files/authorization'
import type { TranscriptSegment } from '@/tools/stt/types'

const logger = createLogger('SttOperations')
const ELEVENLABS_STT_MODEL = 'scribe_v2'

interface TimedWord {
  text: string
  start: number
  end: number
  confidence?: number
  speaker?: string | number
  speaker_id?: string
  type?: string
  word?: string
  transcript?: string
}

interface WhisperApiResponse {
  text: string
  segments?: TimedWord[]
  words?: TimedWord[]
  language?: string
  duration?: number
  error?: { message?: string }
  message?: string
}

interface DeepgramAlternative {
  transcript: string
  confidence?: number
  words?: TimedWord[]
}

interface DeepgramApiResponse {
  results?: {
    channels?: Array<{
      alternatives?: DeepgramAlternative[]
      detected_language?: string
    }>
    utterances?: TimedWord[]
  }
  metadata?: { duration?: number }
  err_msg?: string
  message?: string
}

interface ElevenLabsApiResponse {
  text?: string
  words?: TimedWord[]
  language_code?: string
  detail?: string | { message?: string }
  message?: string
}

interface AssemblyAiTranscriptRequest {
  audio_url: string
  speech_model?: 'best' | 'slam-1' | 'universal'
  language_code?: string
  language_detection?: boolean
  speaker_labels?: boolean
  sentiment_analysis?: boolean
  entity_detection?: boolean
  redact_pii?: boolean
  redact_pii_policies?: string[]
  summarization?: boolean
  summary_model?: 'informative'
  summary_type?: 'bullets'
}

interface AssemblyAiTranscript {
  status: string
  error?: string
  text: string
  words?: TimedWord[]
  language_code?: string
  audio_duration?: number
  confidence?: number
  sentiment_analysis_results?: Record<string, unknown>[]
  entities?: Record<string, unknown>[]
  summary?: string
}

interface AssemblyAiApiResponse extends Partial<AssemblyAiTranscript> {
  id?: string
  upload_url?: string
  error?: string
}

interface GeminiApiResponse {
  error?: { message?: string }
  candidates?: Array<{
    finishReason?: string
    content?: { parts?: Array<{ text?: string }> }
  }>
}

interface SttOutput {
  transcript: string
  segments?: TranscriptSegment[]
  language?: string
  duration?: number
  confidence?: number
  sentiment?: Record<string, unknown>[]
  entities?: Record<string, unknown>[]
  summary?: string
}

export interface SttOperationContext {
  headers: Headers
  userId: string
  requestId: string
  signal?: AbortSignal
}

export async function executeSttOperation(
  body: SttOperationInput,
  context: SttOperationContext
): Promise<Response> {
  const { headers, requestId, signal, userId } = context
  signal?.throwIfAborted()
  logger.info(`[${requestId}] STT transcription request started`)

  try {
    const modelInputProvenance = validateOpaqueModelInputProvenance({
      headers,
      payload: body,
      isInternalRequest: true,
    })
    if (!modelInputProvenance.success) {
      return Response.json(
        { error: modelInputProvenance.error },
        { status: modelInputProvenance.status }
      )
    }

    const {
      provider,
      apiKey,
      model,
      language,
      timestamps,
      diarization,
      translateToEnglish,
      sentiment,
      entityDetection,
      piiRedaction,
      summarization,
    } = body

    let audioBuffer: Buffer
    let audioFileName: string
    let audioMimeType: string

    if (body.audioFile) {
      if (Array.isArray(body.audioFile) && body.audioFile.length !== 1) {
        return Response.json({ error: 'audioFile must be a single file' }, { status: 400 })
      }
      const file = Array.isArray(body.audioFile) ? body.audioFile[0] : body.audioFile
      logger.info(`[${requestId}] Processing uploaded audio`)

      const deniedAudio = await assertToolFileAccess(file.key, userId, requestId, logger)
      if (deniedAudio) return deniedAudio
      if (!(await isModelSafeWorkspaceFileKey(file.key))) {
        return Response.json({ error: MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE }, { status: 400 })
      }
      audioBuffer = await downloadFileFromStorage(file, requestId, logger, {
        maxBytes: MAX_FILE_SIZE,
      })
      signal?.throwIfAborted()
      audioFileName = file.name
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      audioMimeType = file.type || getMimeTypeFromExtension(ext)
    } else if (body.audioFileReference) {
      if (Array.isArray(body.audioFileReference) && body.audioFileReference.length !== 1) {
        return Response.json({ error: 'audioFileReference must be a single file' }, { status: 400 })
      }
      const file = Array.isArray(body.audioFileReference)
        ? body.audioFileReference[0]
        : body.audioFileReference
      logger.info(`[${requestId}] Processing referenced audio`)

      const deniedRef = await assertToolFileAccess(file.key, userId, requestId, logger)
      if (deniedRef) return deniedRef
      if (!(await isModelSafeWorkspaceFileKey(file.key))) {
        return Response.json({ error: MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE }, { status: 400 })
      }
      audioBuffer = await downloadFileFromStorage(file, requestId, logger, {
        maxBytes: MAX_FILE_SIZE,
      })
      signal?.throwIfAborted()
      audioFileName = file.name

      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      audioMimeType = file.type || getMimeTypeFromExtension(ext)
    } else if (body.audioUrl) {
      let audioUrl = body.audioUrl.trim()
      const internalAudioUrl = isInternalFileUrl(audioUrl)
      logger.info(`[${requestId}] Downloading audio source`, { internal: internalAudioUrl })
      if (audioUrl.startsWith('/') && !isInternalFileUrl(audioUrl)) {
        return Response.json(
          {
            error: 'Invalid file path. Only uploaded files are supported for internal paths.',
          },
          { status: 400 }
        )
      }

      if (internalAudioUrl) {
        if (!userId) {
          return Response.json(
            { error: 'Authentication required for internal file access' },
            { status: 401 }
          )
        }
        const resolution = await resolveInternalFileUrl(audioUrl, userId, requestId, logger)
        if (resolution.error) {
          return Response.json(
            { error: resolution.error.message },
            { status: resolution.error.status }
          )
        }
        audioUrl = resolution.fileUrl || audioUrl
        if (!(await isModelSafeWorkspaceFileKey(extractStorageKey(body.audioUrl)))) {
          return Response.json(
            { error: MODEL_UNSAFE_WORKSPACE_FILE_ERROR_MESSAGE },
            { status: 400 }
          )
        }
      }

      // A caller-supplied audio URL is content; a resolved internal one is a
      // presigned URL against Sim's own storage, which on a self-hosted
      // deployment legitimately sits on a private address.
      const audioProfile: EgressProfile = internalAudioUrl ? 'configuredEndpoint' : 'contentFetch'

      const urlValidation = await validateUrlWithDNS(audioUrl, 'audioUrl', audioProfile)
      if (!urlValidation.isValid) {
        return Response.json({ error: urlValidation.error }, { status: 400 })
      }

      const response = await secureFetchWithPinnedIP(audioUrl, urlValidation.resolvedIP, {
        profile: audioProfile,
        method: 'GET',
        maxResponseBytes: MAX_FILE_SIZE,
        signal,
      })
      if (!response.ok) {
        await response.text().catch(() => {})
        throw new Error(`Failed to download audio from URL: ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      signal?.throwIfAborted()
      audioBuffer = Buffer.from(arrayBuffer)
      audioFileName = audioUrl.split('/').pop() || 'audio_file'
      audioMimeType = response.headers.get('content-type') || 'audio/mpeg'
    } else {
      return Response.json(
        { error: 'No audio source provided. Provide audioFile, audioFileReference, or audioUrl' },
        { status: 400 }
      )
    }

    if (isVideoFile(audioMimeType)) {
      logger.info(`[${requestId}] Extracting audio from video file`)
      try {
        const extracted = await extractAudioFromVideo(audioBuffer, audioMimeType, {
          outputFormat: 'mp3',
          sampleRate: 16000,
          channels: 1,
          signal,
        })
        signal?.throwIfAborted()
        audioBuffer = extracted.buffer
        audioMimeType = 'audio/mpeg'
        audioFileName = audioFileName.replace(/\.[^.]+$/, '.mp3')
      } catch (error) {
        signal?.throwIfAborted()
        logger.error(`[${requestId}] Video extraction failed:`, error)
        if (isPayloadSizeLimitError(error)) {
          return Response.json(
            { error: 'Extracted audio exceeds the maximum supported size' },
            { status: 413 }
          )
        }
        return Response.json(
          {
            error: `Failed to extract audio from video: ${getErrorMessage(error, 'Unknown error')}`,
          },
          { status: 500 }
        )
      }
    }

    logger.info(`[${requestId}] Transcribing audio`, { provider })

    let transcript: string
    let segments: TranscriptSegment[] | undefined
    let detectedLanguage: string | undefined
    let duration: number | undefined
    let confidence: number | undefined
    let sentimentResults: Record<string, unknown>[] | undefined
    let entities: Record<string, unknown>[] | undefined
    let summary: string | undefined

    try {
      if (provider === 'whisper') {
        const result = await transcribeWithWhisper(
          audioBuffer,
          apiKey,
          language,
          timestamps,
          translateToEnglish,
          model,
          body.prompt,
          body.temperature,
          audioMimeType,
          audioFileName,
          signal
        )
        transcript = result.transcript
        segments = result.segments
        detectedLanguage = result.language
        duration = result.duration
      } else if (provider === 'deepgram') {
        const result = await transcribeWithDeepgram(
          audioBuffer,
          apiKey,
          language,
          timestamps,
          diarization,
          model,
          audioMimeType,
          signal
        )
        transcript = result.transcript
        segments = result.segments
        detectedLanguage = result.language
        duration = result.duration
        confidence = result.confidence
      } else if (provider === 'elevenlabs') {
        const result = await transcribeWithElevenLabs(
          audioBuffer,
          apiKey,
          language,
          timestamps,
          signal
        )
        transcript = result.transcript
        segments = result.segments
        detectedLanguage = result.language
        duration = result.duration
      } else if (provider === 'assemblyai') {
        const result = await transcribeWithAssemblyAI(
          audioBuffer,
          apiKey,
          language,
          timestamps,
          diarization,
          sentiment,
          entityDetection,
          piiRedaction,
          summarization,
          model,
          signal
        )
        transcript = result.transcript
        segments = result.segments
        detectedLanguage = result.language
        duration = result.duration
        confidence = result.confidence
        sentimentResults = result.sentiment
        entities = result.entities
        summary = result.summary
      } else if (provider === 'gemini') {
        const result = await transcribeWithGemini(
          audioBuffer,
          apiKey,
          audioMimeType,
          language,
          timestamps,
          model,
          signal
        )
        transcript = result.transcript
        segments = result.segments
        detectedLanguage = result.language
        duration = result.duration
        confidence = result.confidence
      } else {
        return Response.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
      }
    } catch (error) {
      signal?.throwIfAborted()
      logger.error(`[${requestId}] Transcription failed:`, error)
      const errorMessage = getErrorMessage(error, 'Transcription failed')
      return Response.json({ error: errorMessage }, { status: 500 })
    }

    logger.info(`[${requestId}] Transcription completed successfully`)

    const response: SttOutput = { transcript }
    if (segments !== undefined) response.segments = segments
    if (detectedLanguage !== undefined) response.language = detectedLanguage
    if (duration !== undefined) response.duration = duration
    if (confidence !== undefined) response.confidence = confidence
    if (sentimentResults !== undefined) response.sentiment = sentimentResults
    if (entities !== undefined) response.entities = entities
    if (summary !== undefined) response.summary = summary

    return Response.json(response)
  } catch (error) {
    signal?.throwIfAborted()
    logger.error(`[${requestId}] STT proxy error:`, error)
    const isSizeLimit = isPayloadSizeLimitError(error)
    const errorMessage = isSizeLimit
      ? 'Audio file exceeds the maximum supported size'
      : getErrorMessage(error, 'Unknown error')
    return Response.json({ error: errorMessage }, { status: isSizeLimit ? 413 : 500 })
  }
}

async function transcribeWithWhisper(
  audioBuffer: Buffer,
  apiKey: string,
  language?: string,
  timestamps?: 'none' | 'sentence' | 'word',
  translate?: boolean,
  model?: string,
  prompt?: string,
  temperature?: number,
  mimeType?: string,
  fileName?: string,
  signal?: AbortSignal
): Promise<{
  transcript: string
  segments?: TranscriptSegment[]
  language?: string
  duration?: number
}> {
  const formData = new FormData()

  const actualMimeType = mimeType || 'audio/mpeg'
  const actualFileName = fileName || 'audio.mp3'
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: actualMimeType })
  formData.append('file', blob, actualFileName)
  formData.append('model', model || 'whisper-1')

  if (language && language !== 'auto') {
    formData.append('language', language)
  }

  if (prompt) {
    formData.append('prompt', prompt)
  }

  if (temperature !== undefined) {
    formData.append('temperature', temperature.toString())
  }

  formData.append('response_format', 'verbose_json')

  if (timestamps === 'word') {
    formData.append('timestamp_granularities[]', 'word')
  } else if (timestamps === 'sentence') {
    formData.append('timestamp_granularities[]', 'segment')
  }

  const endpoint = translate ? 'translations' : 'transcriptions'
  const response = await fetch(`https://api.openai.com/v1/audio/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
    signal,
  })

  if (!response.ok) {
    const error = (await response.json()) as WhisperApiResponse
    const errorMessage = error.error?.message || error.message || JSON.stringify(error)
    throw new Error(`Whisper API error: ${errorMessage}`)
  }

  const data = (await response.json()) as WhisperApiResponse

  let segments: TranscriptSegment[] | undefined
  if (timestamps !== 'none') {
    segments = (data.segments || data.words || []).map((seg) => ({
      text: seg.text,
      start: seg.start,
      end: seg.end,
    }))
  }

  return {
    transcript: data.text,
    segments,
    language: data.language,
    duration: data.duration,
  }
}

async function transcribeWithDeepgram(
  audioBuffer: Buffer,
  apiKey: string,
  language?: string,
  timestamps?: 'none' | 'sentence' | 'word',
  diarization?: boolean,
  model?: string,
  mimeType?: string,
  signal?: AbortSignal
): Promise<{
  transcript: string
  segments?: TranscriptSegment[]
  language?: string
  duration?: number
  confidence?: number
}> {
  const params = new URLSearchParams({
    model: model || 'nova-3',
    smart_format: 'true',
    punctuate: 'true',
  })

  if (language && language !== 'auto') {
    params.append('language', language)
  } else if (language === 'auto') {
    params.append('detect_language', 'true')
  }

  if (timestamps === 'sentence') {
    params.append('utterances', 'true')
  }

  if (diarization) {
    params.append('diarize', 'true')
  }

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': mimeType || 'audio/mpeg',
    },
    body: new Uint8Array(audioBuffer),
    signal,
  })

  if (!response.ok) {
    const error = (await response.json()) as DeepgramApiResponse
    const errorMessage = error.err_msg || error.message || JSON.stringify(error)
    throw new Error(`Deepgram API error: ${errorMessage}`)
  }

  const data = (await response.json()) as DeepgramApiResponse
  const result = data.results?.channels?.[0]?.alternatives?.[0]

  if (!result) {
    throw new Error('No transcription result from Deepgram')
  }

  const transcript = result.transcript
  const detectedLanguage = data.results?.channels?.[0]?.detected_language
  const confidence = result.confidence

  let segments: TranscriptSegment[] | undefined
  if (result.words && timestamps === 'word') {
    segments = result.words.map((word) => ({
      text: word.word ?? word.text,
      start: word.start,
      end: word.end,
      speaker: word.speaker !== undefined ? `Speaker ${word.speaker}` : undefined,
      confidence: word.confidence,
    }))
  } else if (data.results?.utterances && timestamps === 'sentence') {
    segments = data.results.utterances.map((utterance) => ({
      text: utterance.transcript ?? utterance.text,
      start: utterance.start,
      end: utterance.end,
      speaker: utterance.speaker !== undefined ? `Speaker ${utterance.speaker}` : undefined,
      confidence: utterance.confidence,
    }))
  }

  return {
    transcript,
    segments,
    language: detectedLanguage,
    duration: data.metadata?.duration,
    confidence,
  }
}

async function transcribeWithElevenLabs(
  audioBuffer: Buffer,
  apiKey: string,
  language?: string,
  timestamps?: 'none' | 'sentence' | 'word',
  signal?: AbortSignal
): Promise<{
  transcript: string
  segments?: TranscriptSegment[]
  language?: string
  duration?: number
}> {
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' })
  formData.append('file', blob, 'audio.mp3')
  formData.append('model_id', ELEVENLABS_STT_MODEL)

  if (language && language !== 'auto') {
    formData.append('language_code', language)
  }

  if (timestamps && timestamps !== 'none') {
    const granularity = timestamps === 'word' ? 'word' : 'word'
    formData.append('timestamps_granularity', granularity)
  } else {
    formData.append('timestamps_granularity', 'word')
  }

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: formData,
    signal,
  })

  if (!response.ok) {
    const error = (await response.json()) as ElevenLabsApiResponse
    const errorMessage =
      typeof error.detail === 'string'
        ? error.detail
        : error.detail?.message || error.message || JSON.stringify(error)
    throw new Error(`ElevenLabs API error: ${errorMessage}`)
  }

  const data = (await response.json()) as ElevenLabsApiResponse

  const words = data.words || []
  const segments: TranscriptSegment[] = words
    .filter((word) => word.type === 'word')
    .map((word) => ({
      text: word.text,
      start: word.start,
      end: word.end,
      speaker: word.speaker_id,
    }))

  return {
    transcript: data.text || '',
    segments: segments.length > 0 ? segments : undefined,
    language: data.language_code,
    duration: undefined, // ElevenLabs doesn't return duration in response
  }
}

async function transcribeWithAssemblyAI(
  audioBuffer: Buffer,
  apiKey: string,
  language?: string,
  timestamps?: 'none' | 'sentence' | 'word',
  diarization?: boolean,
  sentiment?: boolean,
  entityDetection?: boolean,
  piiRedaction?: boolean,
  summarization?: boolean,
  model?: string,
  signal?: AbortSignal
): Promise<{
  transcript: string
  segments?: TranscriptSegment[]
  language?: string
  duration?: number
  confidence?: number
  sentiment?: Record<string, unknown>[]
  entities?: Record<string, unknown>[]
  summary?: string
}> {
  const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
    },
    body: new Uint8Array(audioBuffer),
    signal,
  })

  if (!uploadResponse.ok) {
    const error = (await uploadResponse.json()) as AssemblyAiApiResponse
    throw new Error(`AssemblyAI upload error: ${error.error || JSON.stringify(error)}`)
  }

  const { upload_url } = (await uploadResponse.json()) as AssemblyAiApiResponse
  if (!upload_url) throw new Error('AssemblyAI upload error: Missing upload URL')

  const transcriptRequest: AssemblyAiTranscriptRequest = {
    audio_url: upload_url,
  }

  if (model === 'best' || model === 'slam-1' || model === 'universal') {
    transcriptRequest.speech_model = model
  }

  if (language && language !== 'auto') {
    transcriptRequest.language_code = language
  } else if (language === 'auto') {
    transcriptRequest.language_detection = true
  }

  if (diarization) {
    transcriptRequest.speaker_labels = true
  }

  if (sentiment) {
    transcriptRequest.sentiment_analysis = true
  }

  if (entityDetection) {
    transcriptRequest.entity_detection = true
  }

  if (piiRedaction) {
    transcriptRequest.redact_pii = true
    transcriptRequest.redact_pii_policies = [
      'us_social_security_number',
      'email_address',
      'phone_number',
    ]
  }

  if (summarization) {
    transcriptRequest.summarization = true
    transcriptRequest.summary_model = 'informative'
    transcriptRequest.summary_type = 'bullets'
  }

  const transcriptResponse = await fetch('https://api.assemblyai.com/v2/transcript', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(transcriptRequest),
    signal,
  })

  if (!transcriptResponse.ok) {
    const error = (await transcriptResponse.json()) as AssemblyAiApiResponse
    throw new Error(`AssemblyAI transcript error: ${error.error || JSON.stringify(error)}`)
  }

  const { id } = (await transcriptResponse.json()) as AssemblyAiApiResponse
  if (!id) throw new Error('AssemblyAI transcript error: Missing transcript ID')

  let transcript: AssemblyAiTranscript | undefined
  let attempts = 0
  const pollIntervalMs = 5000
  const maxAttempts = Math.ceil(getMaxExecutionTimeout() / pollIntervalMs)

  while (attempts < maxAttempts) {
    const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: {
        authorization: apiKey,
      },
      signal,
    })

    if (!statusResponse.ok) {
      const error = (await statusResponse.json()) as AssemblyAiApiResponse
      throw new Error(`AssemblyAI status error: ${error.error || JSON.stringify(error)}`)
    }

    transcript = (await statusResponse.json()) as AssemblyAiTranscript

    if (transcript.status === 'completed') {
      break
    }
    if (transcript.status === 'error') {
      throw new Error(`AssemblyAI transcription failed: ${transcript.error}`)
    }

    signal?.throwIfAborted()
    await sleep(pollIntervalMs)
    signal?.throwIfAborted()
    attempts++
  }

  if (!transcript || transcript.status !== 'completed') {
    throw new Error('AssemblyAI transcription timed out')
  }

  let segments: TranscriptSegment[] | undefined
  if (timestamps !== 'none' && transcript.words) {
    segments = transcript.words.map((word) => ({
      text: word.text,
      start: word.start / 1000,
      end: word.end / 1000,
      speaker: word.speaker ? `Speaker ${word.speaker}` : undefined,
      confidence: word.confidence,
    }))
  }

  const result: SttOutput = {
    transcript: transcript.text,
    segments,
    language: transcript.language_code,
    duration: transcript.audio_duration,
    confidence: transcript.confidence,
  }

  if (sentiment && transcript.sentiment_analysis_results) {
    result.sentiment = transcript.sentiment_analysis_results
  }

  if (entityDetection && transcript.entities) {
    result.entities = transcript.entities
  }

  if (summarization && transcript.summary) {
    result.summary = transcript.summary
  }

  return result
}

async function transcribeWithGemini(
  audioBuffer: Buffer,
  apiKey: string,
  mimeType: string,
  language?: string,
  timestamps?: 'none' | 'sentence' | 'word',
  model?: string,
  signal?: AbortSignal
): Promise<{
  transcript: string
  segments?: TranscriptSegment[]
  language?: string
  duration?: number
  confidence?: number
}> {
  const modelName = model || 'gemini-2.5-flash'

  const estimatedSize = audioBuffer.length * 1.34
  if (estimatedSize > 20 * 1024 * 1024) {
    throw new Error('Audio file exceeds 20MB limit for inline data')
  }

  const base64Audio = audioBuffer.toString('base64')

  const languagePrompt = language && language !== 'auto' ? ` The audio is in ${language}.` : ''

  const timestampPrompt =
    timestamps === 'sentence' || timestamps === 'word'
      ? ' Include timestamps in MM:SS format for each sentence.'
      : ''

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64Audio,
            },
          },
          {
            text: `Please transcribe this audio file.${languagePrompt}${timestampPrompt} Provide the full transcript.`,
          },
        ],
      },
    ],
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal,
    }
  )

  if (!response.ok) {
    const error = (await response.json()) as GeminiApiResponse
    if (response.status === 404) {
      throw new Error(
        `Model not found: ${modelName}. Use gemini-3.1-pro-preview, gemini-3-pro-preview, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite, or gemini-2.0-flash-exp`
      )
    }
    const errorMessage = error.error?.message || JSON.stringify(error)
    throw new Error(`Gemini API error: ${errorMessage}`)
  }

  const data = (await response.json()) as GeminiApiResponse

  if (!data.candidates?.[0]?.content?.parts?.[0]?.text) {
    const candidate = data.candidates?.[0]
    if (candidate?.finishReason === 'SAFETY') {
      throw new Error('Content was blocked by safety filters')
    }
    throw new Error('Invalid response structure from Gemini API')
  }

  const transcript = data.candidates[0].content.parts[0].text

  return {
    transcript,
    language: language !== 'auto' ? language : undefined,
  }
}
