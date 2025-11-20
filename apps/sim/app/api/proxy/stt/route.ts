import { type NextRequest, NextResponse } from 'next/server'
import { extractAudioFromVideo, isVideoFile } from '@/lib/audio/extractor'
import { checkHybridAuth } from '@/lib/auth/hybrid'
import { createLogger } from '@/lib/logs/console/logger'
import { downloadFileFromStorage } from '@/lib/uploads/utils/file-utils.server'
import type { UserFile } from '@/executor/types'
import type { TranscriptSegment } from '@/tools/stt/types'

const logger = createLogger('SttProxyAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5 minutes for large files

interface SttRequestBody {
  provider: 'whisper' | 'deepgram' | 'elevenlabs'
  apiKey: string
  model?: string
  audioFile?: UserFile | UserFile[]
  audioFileReference?: UserFile | UserFile[]
  audioUrl?: string
  language?: string
  timestamps?: 'none' | 'sentence' | 'word'
  diarization?: boolean
  translateToEnglish?: boolean
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  logger.info(`[${requestId}] STT transcription request started`)

  try {
    const authResult = await checkHybridAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: SttRequestBody = await request.json()
    const { provider, apiKey, model, language, timestamps, diarization, translateToEnglish } = body

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
      const file = Array.isArray(body.audioFile) ? body.audioFile[0] : body.audioFile
      logger.info(`[${requestId}] Processing uploaded file: ${file.name}`)

      audioBuffer = await downloadFileFromStorage(file, requestId, logger)
      audioFileName = file.name
      audioMimeType = file.type
    } else if (body.audioFileReference) {
      const file = Array.isArray(body.audioFileReference)
        ? body.audioFileReference[0]
        : body.audioFileReference
      logger.info(`[${requestId}] Processing referenced file: ${file.name}`)

      audioBuffer = await downloadFileFromStorage(file, requestId, logger)
      audioFileName = file.name
      audioMimeType = file.type
    } else if (body.audioUrl) {
      logger.info(`[${requestId}] Downloading from URL: ${body.audioUrl}`)

      const response = await fetch(body.audioUrl)
      if (!response.ok) {
        throw new Error(`Failed to download audio from URL: ${response.statusText}`)
      }

      const arrayBuffer = await response.arrayBuffer()
      audioBuffer = Buffer.from(arrayBuffer)
      audioFileName = body.audioUrl.split('/').pop() || 'audio_file'
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

    try {
      if (provider === 'whisper') {
        const result = await transcribeWithWhisper(
          audioBuffer,
          apiKey,
          language,
          timestamps,
          translateToEnglish,
          model
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
          model
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
      } else {
        return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
      }
    } catch (error) {
      logger.error(`[${requestId}] Transcription failed:`, error)
      const errorMessage = error instanceof Error ? error.message : 'Transcription failed'
      return NextResponse.json({ error: errorMessage }, { status: 500 })
    }

    logger.info(`[${requestId}] Transcription completed successfully`)

    return NextResponse.json({
      transcript,
      segments,
      language: detectedLanguage,
      duration,
      confidence,
    })
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
  formData.append('model', model || 'whisper-1')

  if (language && language !== 'auto') {
    formData.append('language', language)
  }

  if (timestamps === 'word') {
    formData.append('response_format', 'verbose_json')
    formData.append('timestamp_granularities[]', 'word')
  } else if (timestamps === 'sentence') {
    formData.append('response_format', 'verbose_json')
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

  if (timestamps === 'none') {
    return {
      transcript: data.text,
      language: data.language,
    }
  }
  const segments: TranscriptSegment[] = (data.segments || data.words || []).map((seg: any) => ({
    text: seg.text,
    start: seg.start,
    end: seg.end,
  }))

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
  model?: string
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
  }

  if (timestamps !== 'none') {
    params.append('utterances', 'true')
  }

  if (diarization) {
    params.append('diarize', 'true')
  }

  const response = await fetch(`https://api.deepgram.com/v1/listen?${params.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'audio/mpeg',
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
  if (timestamps !== 'none' && result.words) {
    segments = result.words.map((word: any) => ({
      text: word.word,
      start: word.start,
      end: word.end,
      speaker: word.speaker !== undefined ? `Speaker ${word.speaker}` : undefined,
      confidence: word.confidence,
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
    formData.append('language', language)
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

  return {
    transcript: data.text || '',
    language: data.language,
    duration: data.duration,
  }
}
