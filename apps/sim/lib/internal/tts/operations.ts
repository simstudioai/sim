import { createLogger } from '@sim/logger'
import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  type AzureTtsOperationInput,
  type CartesiaTtsOperationInput,
  type OpenAiTtsOperationInput,
  synthesizeAzure,
  synthesizeCartesia,
  synthesizeDeepgram,
  synthesizeElevenLabs,
  synthesizeGoogle,
  synthesizeLegacyElevenLabs,
  synthesizeOpenAi,
  synthesizePlayHt,
  type TtsAudioResult,
} from '@/lib/internal/tts/client'
import { getTtsFileExtension } from '@/lib/internal/tts/formats'
import { StorageService } from '@/lib/uploads'
import { uploadExecutionFile } from '@/lib/uploads/contexts/execution'
import type { ElevenLabsTtsParams } from '@/tools/elevenlabs/types'
import type {
  DeepgramTtsParams,
  ElevenLabsTtsUnifiedParams,
  GoogleTtsParams,
  PlayHtTtsParams,
  TtsProvider,
  TtsResponse,
} from '@/tools/tts/types'

const logger = createLogger('TtsOperations')

export interface TtsOperationContext {
  requestId: string
  signal?: AbortSignal
  userId: string
  workspaceId?: string
  workflowId?: string
  executionId?: string
}

async function storeUnifiedAudio(
  provider: TtsProvider,
  text: string,
  audio: TtsAudioResult,
  context: TtsOperationContext
): Promise<TtsResponse> {
  context.signal?.throwIfAborted()
  const fileName = `tts-${provider}-${Date.now()}.${getTtsFileExtension(audio.format)}`
  if (context.workspaceId && context.workflowId && context.executionId) {
    const audioFile = await uploadExecutionFile(
      {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      audio.audioBuffer,
      fileName,
      audio.mimeType,
      context.userId
    )
    context.signal?.throwIfAborted()
    logger.info('Stored TTS audio in execution context', {
      requestId: context.requestId,
      provider,
      executionId: context.executionId,
      fileName,
      size: audioFile.size,
    })
    return {
      audioUrl: audioFile.url,
      audioFile,
      characterCount: text.length,
      format: audio.format,
      provider,
      ...(audio.duration ? { duration: audio.duration } : {}),
    }
  }

  const file = await StorageService.uploadFile({
    file: audio.audioBuffer,
    fileName,
    contentType: audio.mimeType,
    context: 'copilot',
  })
  context.signal?.throwIfAborted()
  logger.info('Stored TTS audio in copilot context', {
    requestId: context.requestId,
    provider,
    fileName,
    size: file.size,
  })
  return {
    audioUrl: `${getBaseUrl()}${file.path}`,
    characterCount: text.length,
    format: audio.format,
    provider,
    ...(audio.duration ? { duration: audio.duration } : {}),
  }
}

async function storeLegacyElevenLabsAudio(
  audio: TtsAudioResult,
  context: TtsOperationContext
): Promise<Record<string, unknown>> {
  context.signal?.throwIfAborted()
  const fileName = `tts-${Date.now()}.mp3`
  if (context.workspaceId && context.workflowId && context.executionId) {
    const audioFile = await uploadExecutionFile(
      {
        workspaceId: context.workspaceId,
        workflowId: context.workflowId,
        executionId: context.executionId,
      },
      audio.audioBuffer,
      fileName,
      audio.mimeType,
      context.userId
    )
    context.signal?.throwIfAborted()
    return { audioFile, audioUrl: audioFile.url }
  }
  const file = await StorageService.uploadFile({
    file: audio.audioBuffer,
    fileName,
    contentType: audio.mimeType,
    context: 'copilot',
  })
  context.signal?.throwIfAborted()
  return { audioUrl: `${getBaseUrl()}${file.path}`, size: file.size }
}

export async function executeOpenAiTts(
  input: OpenAiTtsOperationInput,
  context: TtsOperationContext
): Promise<TtsResponse> {
  return storeUnifiedAudio(
    'openai',
    input.text,
    await synthesizeOpenAi(input, context.signal),
    context
  )
}

export async function executeDeepgramTts(
  input: DeepgramTtsParams,
  context: TtsOperationContext
): Promise<TtsResponse> {
  return storeUnifiedAudio(
    'deepgram',
    input.text,
    await synthesizeDeepgram(input, context.signal),
    context
  )
}

export async function executeElevenLabsTts(
  input: ElevenLabsTtsUnifiedParams,
  context: TtsOperationContext
): Promise<TtsResponse> {
  return storeUnifiedAudio(
    'elevenlabs',
    input.text,
    await synthesizeElevenLabs(input, context.signal),
    context
  )
}

export async function executeLegacyElevenLabsTts(
  input: ElevenLabsTtsParams,
  context: TtsOperationContext
): Promise<Record<string, unknown>> {
  return storeLegacyElevenLabsAudio(
    await synthesizeLegacyElevenLabs(input, context.signal),
    context
  )
}

export async function executeCartesiaTts(
  input: CartesiaTtsOperationInput,
  context: TtsOperationContext
): Promise<TtsResponse> {
  return storeUnifiedAudio(
    'cartesia',
    input.text,
    await synthesizeCartesia(input, context.signal),
    context
  )
}

export async function executeGoogleTts(
  input: GoogleTtsParams,
  context: TtsOperationContext
): Promise<TtsResponse> {
  return storeUnifiedAudio(
    'google',
    input.text,
    await synthesizeGoogle(input, context.signal),
    context
  )
}

export async function executeAzureTts(
  input: AzureTtsOperationInput,
  context: TtsOperationContext
): Promise<TtsResponse> {
  return storeUnifiedAudio(
    'azure',
    input.text,
    await synthesizeAzure(input, context.signal),
    context
  )
}

export async function executePlayHtTts(
  input: PlayHtTtsParams,
  context: TtsOperationContext
): Promise<TtsResponse> {
  return storeUnifiedAudio(
    'playht',
    input.text,
    await synthesizePlayHt(input, context.signal),
    context
  )
}
