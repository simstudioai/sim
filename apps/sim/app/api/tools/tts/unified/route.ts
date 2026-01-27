import { createLogger } from '@sim/logger'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { checkInternalAuth } from '@/lib/auth/hybrid'
import { validateAlphanumericId } from '@/lib/core/security/input-validation'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { StorageService } from '@/lib/uploads'
import type {
  AzureTtsParams,
  CartesiaTtsParams,
  DeepgramTtsParams,
  ElevenLabsTtsUnifiedParams,
  GoogleTtsParams,
  OpenAiTtsParams,
  PlayHtTtsParams,
  TtsProvider,
  TtsResponse,
} from '@/tools/tts/types'
import { getFileExtension, getMimeType } from '@/tools/tts/types'

const logger = createLogger('TtsUnifiedProxyAPI')

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 1 minute

interface TtsUnifiedRequestBody {
  provider: TtsProvider
  text: string
  apiKey: string

  // OpenAI specific
  model?: 'tts-1' | 'tts-1-hd' | 'gpt-4o-mini-tts'
  voice?: string
  responseFormat?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm'
  speed?: number

  // Deepgram specific
  encoding?: 'linear16' | 'mp3' | 'opus' | 'aac' | 'flac' | 'mulaw' | 'alaw'
  sampleRate?: number
  bitRate?: number
  container?: 'none' | 'wav' | 'ogg'

  // ElevenLabs specific
  voiceId?: string
  modelId?: string
  stability?: number
  similarityBoost?: number
  style?: number | string
  useSpeakerBoost?: boolean

  // Cartesia specific
  language?: string
  outputFormat?: object
  emotion?: string[]

  // Google Cloud specific
  languageCode?: string
  gender?: 'MALE' | 'FEMALE' | 'NEUTRAL'
  audioEncoding?: 'LINEAR16' | 'MP3' | 'OGG_OPUS' | 'MULAW' | 'ALAW'
  speakingRate?: number
  pitch?: number
  volumeGainDb?: number
  sampleRateHertz?: number
  effectsProfileId?: string[]

  // Azure specific
  region?: string
  rate?: string
  styleDegree?: number
  role?: string

  // PlayHT specific
  userId?: string
  quality?: 'draft' | 'standard' | 'premium'
  temperature?: number
  voiceGuidance?: number
  textGuidance?: number

  // Execution context
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID()
  logger.info(`[${requestId}] TTS unified request started`)

  try {
    const authResult = await checkInternalAuth(request, { requireWorkflowId: false })
    if (!authResult.success) {
      logger.error('Authentication failed for TTS unified proxy:', authResult.error)
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body: TtsUnifiedRequestBody = await request.json()
    const { provider, text, apiKey, workspaceId, workflowId, executionId } = body

    if (!provider || !text || !apiKey) {
      return NextResponse.json(
        { error: 'Missing required fields: provider, text, and apiKey' },
        { status: 400 }
      )
    }

    const hasExecutionContext = workspaceId && workflowId && executionId
    logger.info(`[${requestId}] Processing TTS with ${provider}`, {
      hasExecutionContext,
      textLength: text.length,
    })

    let audioBuffer: Buffer
    let format: string
    let mimeType: string
    let duration: number | undefined

    try {
      if (provider === 'openai') {
        const result = await synthesizeWithOpenAi({
          text,
          apiKey,
          model: body.model,
          voice: body.voice as OpenAiTtsParams['voice'],
          responseFormat: body.responseFormat,
          speed: body.speed,
        })
        audioBuffer = result.audioBuffer
        format = result.format
        mimeType = result.mimeType
      } else if (provider === 'deepgram') {
        const result = await synthesizeWithDeepgram({
          text,
          apiKey,
          model: body.voice,
          encoding: body.encoding,
          sampleRate: body.sampleRate,
          bitRate: body.bitRate,
          container: body.container,
        })
        audioBuffer = result.audioBuffer
        format = result.format
        mimeType = result.mimeType
        duration = result.duration
      } else if (provider === 'elevenlabs') {
        if (!body.voiceId) {
          return NextResponse.json(
            { error: 'voiceId is required for ElevenLabs provider' },
            { status: 400 }
          )
        }
        const voiceIdValidation = validateAlphanumericId(body.voiceId, 'voiceId')
        if (!voiceIdValidation.isValid) {
          return NextResponse.json({ error: voiceIdValidation.error }, { status: 400 })
        }
        const result = await synthesizeWithElevenLabs({
          text,
          apiKey,
          voiceId: body.voiceId,
          modelId: body.modelId,
          stability: body.stability,
          similarityBoost: body.similarityBoost,
          style: body.style as number | undefined,
          useSpeakerBoost: body.useSpeakerBoost,
        })
        audioBuffer = result.audioBuffer
        format = result.format
        mimeType = result.mimeType
      } else if (provider === 'cartesia') {
        const result = await synthesizeWithCartesia({
          text,
          apiKey,
          modelId: body.modelId,
          voice: body.voice,
          language: body.language,
          outputFormat: body.outputFormat,
          speed: body.speed,
          emotion: body.emotion,
        })
        audioBuffer = result.audioBuffer
        format = result.format
        mimeType = result.mimeType
      } else if (provider === 'google') {
        const result = await synthesizeWithGoogle({
          text,
          apiKey,
          voiceId: body.voiceId,
          languageCode: body.languageCode,
          gender: body.gender,
          audioEncoding: body.audioEncoding,
          speakingRate: body.speakingRate,
          pitch: body.pitch,
          volumeGainDb: body.volumeGainDb,
          sampleRateHertz: body.sampleRateHertz,
          effectsProfileId: body.effectsProfileId,
        })
        audioBuffer = result.audioBuffer
        format = result.format
        mimeType = result.mimeType
      } else if (provider === 'azure') {
        const result = await synthesizeWithAzure({
          text,
          apiKey,
          voiceId: body.voiceId,
          region: body.region,
          outputFormat: body.outputFormat as AzureTtsParams['outputFormat'],
          rate: body.rate,
          pitch: body.pitch as string | undefined,
          style: body.style as string | undefined,
          styleDegree: body.styleDegree,
          role: body.role,
        })
        audioBuffer = result.audioBuffer
        format = result.format
        mimeType = result.mimeType
      } else if (provider === 'playht') {
        if (!body.userId) {
          return NextResponse.json(
            { error: 'userId is required for PlayHT provider' },
            { status: 400 }
          )
        }
        const result = await synthesizeWithPlayHT({
          text,
          apiKey,
          userId: body.userId,
          voice: body.voice,
          quality: body.quality,
          outputFormat: typeof body.outputFormat === 'string' ? body.outputFormat : undefined,
          speed: body.speed,
          temperature: body.temperature,
          voiceGuidance: body.voiceGuidance,
          textGuidance: body.textGuidance,
          sampleRate: body.sampleRate,
        })
        audioBuffer = result.audioBuffer
        format = result.format
        mimeType = result.mimeType
      } else {
        return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 })
      }
    } catch (error) {
      logger.error(`[${requestId}] TTS synthesis failed:`, error)
      const errorMessage = error instanceof Error ? error.message : 'TTS synthesis failed'
      return NextResponse.json({ error: errorMessage }, { status: 500 })
    }

    const timestamp = Date.now()
    const fileExtension = getFileExtension(format)
    const fileName = `tts-${provider}-${timestamp}.${fileExtension}`

    if (hasExecutionContext) {
      const { uploadExecutionFile } = await import('@/lib/uploads/contexts/execution')

      const userFile = await uploadExecutionFile(
        { workspaceId, workflowId, executionId },
        audioBuffer,
        fileName,
        mimeType,
        authResult.userId
      )

      logger.info(`[${requestId}] TTS audio stored in execution context:`, {
        executionId,
        fileName,
        size: userFile.size,
      })

      const response: TtsResponse = {
        audioUrl: userFile.url,
        audioFile: userFile,
        characterCount: text.length,
        format,
        provider,
      }

      if (duration) {
        response.duration = duration
      }

      return NextResponse.json(response)
    }

    // Chat UI / copilot usage - no execution context
    const fileInfo = await StorageService.uploadFile({
      file: audioBuffer,
      fileName,
      contentType: mimeType,
      context: 'copilot',
    })

    const audioUrl = `${getBaseUrl()}${fileInfo.path}`

    logger.info(`[${requestId}] TTS audio stored in copilot context:`, {
      fileName,
      size: fileInfo.size,
    })

    const response: TtsResponse = {
      audioUrl,
      characterCount: text.length,
      format,
      provider,
    }

    if (duration) {
      response.duration = duration
    }

    return NextResponse.json(response)
  } catch (error) {
    logger.error(`[${requestId}] TTS unified proxy error:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: errorMessage }, { status: 500 })
  }
}

async function synthesizeWithOpenAi(
  params: OpenAiTtsParams
): Promise<{ audioBuffer: Buffer; format: string; mimeType: string }> {
  const { text, apiKey, model = 'tts-1', responseFormat = 'mp3', speed = 1.0 } = params
  const voice = (params.voice || 'alloy') as OpenAiTtsParams['voice']

  const response = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      response_format: responseFormat,
      speed: Math.max(0.25, Math.min(4.0, speed)),
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const errorMessage = error.error?.message || error.message || response.statusText
    throw new Error(`OpenAI TTS API error: ${errorMessage}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)
  const mimeType = getMimeType(responseFormat)

  return {
    audioBuffer,
    format: responseFormat,
    mimeType,
  }
}

async function synthesizeWithDeepgram(
  params: DeepgramTtsParams
): Promise<{ audioBuffer: Buffer; format: string; mimeType: string; duration?: number }> {
  const {
    text,
    apiKey,
    model = 'aura-asteria-en',
    encoding = 'mp3',
    sampleRate,
    bitRate,
    container,
  } = params

  const queryParams = new URLSearchParams({
    model: model,
    encoding: encoding,
  })

  if (sampleRate && encoding === 'linear16') {
    queryParams.append('sample_rate', sampleRate.toString())
  }

  if (bitRate) {
    queryParams.append('bit_rate', bitRate.toString())
  }

  if (container && container !== 'none') {
    queryParams.append('container', container)
  }

  const response = await fetch(`https://api.deepgram.com/v1/speak?${queryParams.toString()}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const errorMessage = error.err_msg || error.message || response.statusText
    throw new Error(`Deepgram TTS API error: ${errorMessage}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)

  let finalFormat: string = encoding
  if (container === 'wav') {
    finalFormat = 'wav'
  } else if (container === 'ogg') {
    finalFormat = 'ogg'
  }

  const mimeType = getMimeType(finalFormat)

  return {
    audioBuffer,
    format: finalFormat,
    mimeType,
  }
}

async function synthesizeWithElevenLabs(
  params: ElevenLabsTtsUnifiedParams
): Promise<{ audioBuffer: Buffer; format: string; mimeType: string }> {
  const {
    text,
    apiKey,
    voiceId,
    modelId = 'eleven_turbo_v2_5',
    stability = 0.5,
    similarityBoost = 0.8,
    style,
    useSpeakerBoost = true,
  } = params

  const voiceSettings: any = {
    stability: Math.max(0, Math.min(1, stability)),
    similarity_boost: Math.max(0, Math.min(1, similarityBoost)),
    use_speaker_boost: useSpeakerBoost,
  }

  if (style !== undefined) {
    voiceSettings.style = Math.max(0, Math.min(1, style))
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      Accept: 'audio/mpeg',
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: voiceSettings,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const errorMessage =
      typeof error.detail === 'string'
        ? error.detail
        : error.detail?.message || error.message || response.statusText
    throw new Error(`ElevenLabs TTS API error: ${errorMessage}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)

  return {
    audioBuffer,
    format: 'mp3',
    mimeType: 'audio/mpeg',
  }
}

async function synthesizeWithCartesia(
  params: Partial<CartesiaTtsParams>
): Promise<{ audioBuffer: Buffer; format: string; mimeType: string }> {
  const {
    text,
    apiKey,
    modelId = 'sonic-3',
    voice,
    language = 'en',
    outputFormat,
    speed,
    emotion,
  } = params

  if (!text || !apiKey) {
    throw new Error('text and apiKey are required for Cartesia')
  }

  const requestBody: Record<string, unknown> = {
    model_id: modelId,
    transcript: text,
    language,
  }

  if (voice) {
    requestBody.voice = {
      mode: 'id',
      id: voice,
    }
  }

  const generationConfig: Record<string, unknown> = {}
  if (speed !== undefined) generationConfig.speed = speed
  if (emotion !== undefined) generationConfig.emotion = emotion
  if (Object.keys(generationConfig).length > 0) {
    requestBody.generation_config = generationConfig
  }

  if (outputFormat && typeof outputFormat === 'object') {
    requestBody.output_format = outputFormat
  }

  if (!requestBody.output_format) {
    requestBody.output_format = {
      container: 'wav',
      encoding: 'pcm_s16le',
      sample_rate: 24000,
    }
  }

  logger.info('Cartesia API request:', {
    model_id: requestBody.model_id,
    has_voice: !!requestBody.voice,
    language: requestBody.language,
    output_format: requestBody.output_format,
    has_generation_config: !!requestBody.generation_config,
  })

  const response = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Cartesia-Version': '2025-04-16',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const errorMessage = error.error || error.message || response.statusText
    const errorDetail = error.detail || ''
    logger.error('Cartesia API error details:', {
      status: response.status,
      error: errorMessage,
      detail: errorDetail,
      requestBody: JSON.stringify(requestBody),
    })
    throw new Error(
      `Cartesia TTS API error: ${errorMessage}${errorDetail ? ` - ${errorDetail}` : ''}`
    )
  }

  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)

  const format =
    outputFormat && typeof outputFormat === 'object' && 'container' in outputFormat
      ? (outputFormat.container as string)
      : 'mp3'
  const mimeType = getMimeType(format)

  return {
    audioBuffer,
    format,
    mimeType,
  }
}

async function synthesizeWithGoogle(
  params: Partial<GoogleTtsParams>
): Promise<{ audioBuffer: Buffer; format: string; mimeType: string }> {
  const {
    text,
    apiKey,
    voiceId,
    languageCode,
    gender,
    audioEncoding = 'MP3',
    speakingRate = 1.0,
    pitch = 0.0,
    volumeGainDb,
    sampleRateHertz,
    effectsProfileId,
  } = params

  if (!text || !apiKey || !languageCode) {
    throw new Error('text, apiKey, and languageCode are required for Google Cloud TTS')
  }

  const clampedSpeakingRate = Math.max(0.25, Math.min(2.0, speakingRate))

  const audioConfig: Record<string, unknown> = {
    audioEncoding,
    speakingRate: clampedSpeakingRate,
    pitch,
  }

  if (volumeGainDb !== undefined) {
    audioConfig.volumeGainDb = volumeGainDb
  }
  if (sampleRateHertz) {
    audioConfig.sampleRateHertz = sampleRateHertz
  }
  if (effectsProfileId && effectsProfileId.length > 0) {
    audioConfig.effectsProfileId = effectsProfileId
  }

  // Build voice config based on what's provided
  const voice: Record<string, unknown> = {
    languageCode,
  }

  // If voiceId is provided, use it (it takes precedence over gender)
  if (voiceId) {
    voice.name = voiceId
  }

  // Only include gender if specified (don't default to NEUTRAL as it's not supported)
  if (gender) {
    voice.ssmlGender = gender
  }

  // If neither voiceId nor gender is provided, default to a specific voice
  if (!voiceId && !gender) {
    voice.name = 'en-US-Neural2-C'
  }

  const requestBody: Record<string, unknown> = {
    input: { text },
    voice,
    audioConfig,
  }

  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const errorMessage = error.error?.message || error.message || response.statusText
    throw new Error(`Google Cloud TTS API error: ${errorMessage}`)
  }

  const data = await response.json()
  const audioContent = data.audioContent

  if (!audioContent) {
    throw new Error('No audio content returned from Google Cloud TTS')
  }

  const audioBuffer = Buffer.from(audioContent, 'base64')

  const format = audioEncoding.toLowerCase().replace('_', '')
  const mimeType = getMimeType(format)

  return {
    audioBuffer,
    format,
    mimeType,
  }
}

async function synthesizeWithAzure(
  params: Partial<AzureTtsParams>
): Promise<{ audioBuffer: Buffer; format: string; mimeType: string }> {
  const {
    text,
    apiKey,
    voiceId = 'en-US-JennyNeural',
    region = 'eastus',
    outputFormat = 'audio-24khz-96kbitrate-mono-mp3',
    rate,
    pitch,
    style,
    styleDegree,
    role,
  } = params

  if (!text || !apiKey) {
    throw new Error('text and apiKey are required for Azure TTS')
  }

  let ssml = `<speak version='1.0' xml:lang='en-US' xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts"><voice name='${voiceId}'>`

  if (style) {
    ssml += `<mstts:express-as style='${style}'`
    if (styleDegree) ssml += ` styledegree='${styleDegree}'`
    if (role) ssml += ` role='${role}'`
    ssml += '>'
  }

  if (rate || pitch) {
    ssml += '<prosody'
    if (rate) ssml += ` rate='${rate}'`
    if (pitch) ssml += ` pitch='${pitch}'`
    ssml += '>'
  }

  ssml += text

  if (rate || pitch) {
    ssml += '</prosody>'
  }

  if (style) {
    ssml += '</mstts:express-as>'
  }

  ssml += '</voice></speak>'

  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': outputFormat,
    },
    body: ssml,
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Azure TTS API error: ${error || response.statusText}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)

  const format = outputFormat.includes('mp3') ? 'mp3' : 'wav'
  const mimeType = getMimeType(format)

  return {
    audioBuffer,
    format,
    mimeType,
  }
}

async function synthesizeWithPlayHT(
  params: Partial<PlayHtTtsParams>
): Promise<{ audioBuffer: Buffer; format: string; mimeType: string }> {
  const {
    text,
    apiKey,
    userId,
    voice,
    quality = 'standard',
    outputFormat = 'mp3',
    speed = 1.0,
    temperature,
    voiceGuidance,
    textGuidance,
    sampleRate,
  } = params

  if (!text || !apiKey || !userId) {
    throw new Error('text, apiKey, and userId are required for PlayHT')
  }

  const requestBody: Record<string, unknown> = {
    text,
    quality,
    output_format: outputFormat,
    speed,
  }

  if (voice) requestBody.voice = voice
  if (temperature !== undefined) requestBody.temperature = temperature
  if (voiceGuidance !== undefined) requestBody.voice_guidance = voiceGuidance
  if (textGuidance !== undefined) requestBody.text_guidance = textGuidance
  if (sampleRate) requestBody.sample_rate = sampleRate

  const response = await fetch('https://api.play.ht/api/v2/tts/stream', {
    method: 'POST',
    headers: {
      AUTHORIZATION: apiKey,
      'X-USER-ID': userId,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    const errorMessage = error.error_message || error.message || response.statusText
    throw new Error(`PlayHT TTS API error: ${errorMessage}`)
  }

  const arrayBuffer = await response.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)

  const format = outputFormat || 'mp3'
  const mimeType = getMimeType(format)

  return {
    audioBuffer,
    format,
    mimeType,
  }
}
