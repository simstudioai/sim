import { createLogger } from '@sim/logger'
import { type NextRequest, NextResponse } from 'next/server'
import { extractAudioFromVideo, isVideoFile } from '@/lib/audio/extractor'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { getMimeTypeFromExtension, isInternalFileUrl } from '@/lib/uploads/utils/file-utils'
import {
  downloadFileFromStorage,
  resolveInternalFileUrl,
} from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'
import type { TranscriptSegment } from '@/tools/stt/types'

const logger = createLogger('SttProxyAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for large files

interface SttRequestBody {
  provider: 'whisper' | 'deepgram' | 'elevenlabs' | 'assemblyai' | 'gemini'
  apiKey: string
  model?: string
  audioFile?: UserFile | UserFile[]
  audioFileReference?: UserFile | UserFile[]
  audioUrl?: string
  language?: string
  timestamps?: 'none' | 'sentence' | 'word'
  diarization?: boolean
  translateToEnglish?: boolean
  // Whisper-specific options
  prompt?: string
  temperature?: number
  // AssemblyAI-specific options
  sentiment?: boolean
  entityDetection?: boolean
  piiRedaction?: boolean
  summarization?: boolean
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  logger.info(`[${requestId}] STT transcription request started`)

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = authResult.userId
    const body: SttRequestBody = await request.json()
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

    if (!provider || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: provider and apiKey' },
        { status: 400 }
      )
    }

    let audioBuffer: Buffer
    let audioFileName: string
    let audioMimeType: string

    if (body.audioFile) {
      if (Array.isArray(body.audioFile) && body.audioFile.length !== 1) {
        return NextResponse.json({ error: 'audioFile must be a single file' }, { status: 400 })
      }
      const file = Array.isArray(body.audioFile) ? body.audioFile[0] : body.audioFile
      logger.info(`[${requestId}] Processing uploaded file: ${file.name}`)

      audioBuffer = await downloadFileFromStorage(file, requestId, logger)
      audioFileName = file.name
      // file.type may be missing if the file came from a block that doesn't preserve it
      // Infer from filename extension as fallback
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      audioMimeType = file.type || getMimeTypeFromExtension(ext)
    } else if (body.audioFileReference) {
      if (Array.isArray(body.audioFileReference) && body.audioFileReference.length !== 1) {
        return NextResponse.json(
          { error: 'audioFileReference must be a single file' },
          { status: 400 }
        )
      }
      const file = Array.isArray(body.audioFileReference)
        ? body.audioFileReference[0]
        : body.audioFileReference
      logger.info(`[${requestId}] Processing referenced file: ${file.name}`)

      audioBuffer = await downloadFileFromStorage(file, requestId, logger)
      audioFileName = file.name

      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      audioMimeType = file.type || getMimeTypeFromExtension(ext)
    } else if (body.audioUrl) {
      logger.info(`[${requestId}] Downloading from URL: ${body.audioUrl}`)

      let audioUrl = body.audioUrl.trim()
      if (audioUrl.startsWith('/') && !isInternalFileUrl(audioUrl)) {
        return NextResponse.json(
          {
            error: 'Invalid file path. Only uploaded files are supported for internal paths.',
          },
          { status: 400 }
        )
      }

      if (isInternalFileUrl(audioUrl)) {
        if (!userId) {
          return NextResponse.json(
            { error: 'Authentication required for internal file access' },
            { status: 401 }
          )
        }
        const resolution = await resolveInternalFileUrl(audioUrl, userId, requestId, logger)
        if (resolution.error) {
          return NextResponse.json(
            { error: resolution.error.message },
            { status: resolution.error.status }
          )
        }
        audioUrl = resolution.fileUrl || audioUrl
      }

      const urlValidation = await validateUrlWithDNS(audioUrl, 'audioUrl')
      if (!urlValidation.isValid) {
        return NextResponse.json({ error: urlValidation.error }, { status: 400 })
      }

      const response = await secureFetchWithPinnedIP(audioUrl, urlValidation.resolvedIP!, {
        method: 'GET',
      })
      if (!response.ok) {
        throw new Error(`Failed to download audio from URL: ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      audioBuffer = Buffer.from(arrayBuffer)
      audioFileName = audioUrl.split('/').pop() || 'audio_file'
      audioMimeType = response.headers.get('content-type') || 'audio/mpeg'
    } else {
      return NextResponse.json(
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
        })
        audioBuffer = extracted.buffer
        audioMimeType = 'audio/mpeg'
        audioFileName = audioFileName.replace(/\.[^.]+$/, '.mp3')
      } catch (error) {
        logger.error(`[${requestId}] Video extraction failed:`, error)
        return NextResponse.json(
          {
            error: `Failed to extract audio from video: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
          { status: 500 }
        )
      }
    }

    logger.info(`[${requestId}] Transcribing with ${provider}, file: ${audioFileName}`)

    let transcript: string
    let segments: TranscriptSegment[] | undefined
    let detectedLanguage: string | undefined
    let duration: number | undefined
    let confidence: number | undefined
    let sentimentResults: any[] | undefined
    let entities: any[] | undefined
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
          audioFileName
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
          audioMimeType
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
          model
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
          model
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
          model
        )
        transcript = result.transcript
        segments = result.segments
        detectedLanguage = result.language
        duration = result.duration
        confidence = result.confidence
      } else {
        return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
      }
    } catch (error) {
      logger.error(`[${requestId}] Transcription failed:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Transcription failed'
      return NextResponse.json({ error: errorMessage }, { status: 500 })
    }

    logger.info(`[${requestId}] Transcription completed successfully`)

    const response: Record<string, any> = { transcript }
    if (segments !== undefined) response.segments = segments
    if (detectedLanguage !== undefined) response.language = detectedLanguage
    if (duration !== undefined) response.duration = duration
    if (confidence !== undefined) response.confidence = confidence
    if (sentimentResults !== undefined) response.sentiment = sentimentResults
    if (entities !== undefined) response.entities = entities
    if (summary !== undefined) response.summary = summary

    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] STT proxy error:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
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
  fileName?: string
): Promise<{
  transcript: string
  segments?: TranscriptSegment[]
  language?: string
  duration?: number
}> {
  const formData = new FormData()

  // Use actual MIME type and filename if provided
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

  // OpenAI API uses array notation for timestamp_granularities
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
  })

  if (!response.ok) {
    const error = await response.json()
    const errorMessage = error.error?.message || error.message || JSON.stringify(error)
    throw new Error(`Whisper API error: ${errorMessage}`)
  }

  const data = await response.json()

  let segments: TranscriptSegment[] | undefined
  if (timestamps !== 'none') {
    segments = (data.segments || data.words || []).map((seg: any) => ({
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
  mimeType?: string
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
  })

  if (!response.ok) {
    const error = await response.json()
    const errorMessage = error.err_msg || error.message || JSON.stringify(error)
    throw new Error(`Deepgram API error: ${errorMessage}`)
  }

  const data = await response.json()
  const result = data.results?.channels?.[0]?.alternatives?.[0]

  if (!result) {
    throw new Error('No transcription result from Deepgram')
  }

  const transcript = result.transcript
  const detectedLanguage = data.results?.channels?.[0]?.detected_language
  const confidence = result.confidence

  let segments: TranscriptSegment[] | undefined
  if (result.words && timestamps === 'word') {
    segments = result.words.map((word: any) => ({
      text: word.word,
      start: word.start,
      end: word.end,
      speaker: word.speaker !== undefined ? `Speaker ${word.speaker}` : undefined,
      confidence: word.confidence,
    }))
  } else if (data.results?.utterances && timestamps === 'sentence') {
    segments = data.results.utterances.map((utterance: any) => ({
      text: utterance.transcript,
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
  model?: string
): Promise<{
  transcript: string
  segments?: TranscriptSegment[]
  language?: string
  duration?: number
}> {
  const formData = new FormData()
  const blob = new Blob([new Uint8Array(audioBuffer)], { type: 'audio/mpeg' })
  formData.append('file', blob, 'audio.mp3')
  formData.append('model_id', model || 'scribe_v1')

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
  })

  if (!response.ok) {
    const error = await response.json()
    const errorMessage =
      typeof error.detail === 'string'
        ? error.detail
        : error.detail?.message || error.message || JSON.stringify(error)
    throw new Error(`ElevenLabs API error: ${errorMessage}`)
  }

  const data = await response.json()

  const words = data.words || []
  const segments: TranscriptSegment[] = words
    .filter((w: any) => w.type === 'word')
    .map((w: any) => ({
      text: w.text,
      start: w.start,
      end: w.end,
      speaker: w.speaker_id,
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
  model?: string
): Promise<{
  transcript: string
  segments?: TranscriptSegment[]
  language?: string
  duration?: number
  confidence?: number
  sentiment?: any[]
  entities?: any[]
  summary?: string
}> {
  const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
    },
    body: new Uint8Array(audioBuffer),
  })

  if (!uploadResponse.ok) {
    const error = await uploadResponse.json()
    throw new Error(`AssemblyAI upload error: ${error.error || JSON.stringify(error)}`)
  }

  const { upload_url } = await uploadResponse.json()

  const transcriptRequest: any = {
    audio_url: upload_url,
  }

  // AssemblyAI supports 'best', 'slam-1', or 'universal' for speech_model
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
  })

  if (!transcriptResponse.ok) {
    const error = await transcriptResponse.json()
    throw new Error(`AssemblyAI transcript error: ${error.error || JSON.stringify(error)}`)
  }

  const { id } = await transcriptResponse.json()

  let transcript: any
  let attempts = 0
  const pollIntervalMs = 5000
  const maxAttempts = Math.ceil(DEFAULT_EXECUTION_TIMEOUT_MS / pollIntervalMs)

  while (attempts < maxAttempts) {
    const statusResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: {
        authorization: apiKey,
      },
    })

    if (!statusResponse.ok) {
      const error = await statusResponse.json()
      throw new Error(`AssemblyAI status error: ${error.error || JSON.stringify(error)}`)
    }

    transcript = await statusResponse.json()

    if (transcript.status === 'completed') {
      break
    }
    if (transcript.status === 'error') {
      throw new Error(`AssemblyAI transcription failed: ${transcript.error}`)
    }

    await new Promise((resolve) => setTimeout(resolve, 5000))
    attempts++
  }

  if (transcript.status !== 'completed') {
    throw new Error('AssemblyAI transcription timed out')
  }

  let segments: TranscriptSegment[] | undefined
  if (timestamps !== 'none' && transcript.words) {
    segments = transcript.words.map((word: any) => ({
      text: word.text,
      start: word.start / 1000,
      end: word.end / 1000,
      speaker: word.speaker ? `Speaker ${word.speaker}` : undefined,
      confidence: word.confidence,
    }))
  }

  const result: any = {
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
  model?: string
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
    }
  )

  if (!response.ok) {
    const error = await response.json()
    if (response.status === 404) {
      throw new Error(
        `Model not found: ${modelName}. Use gemini-3-pro-preview, gemini-2.5-pro, gemini-2.5-flash, gemini-2.5-flash-lite, or gemini-2.0-flash-exp`
      )
    }
    const errorMessage = error.error?.message || JSON.stringify(error)
    throw new Error(`Gemini API error: ${errorMessage}`)
  }

  const data = await response.json()

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
