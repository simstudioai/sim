import { getErrorMessage } from '@sim/utils/errors'
import { z } from 'zod'
import { getValidationErrorMessage } from '@/lib/api/server'
import { isPayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import type {
  InternalToolOperationCall,
  InternalToolOperationHandler,
} from '@/lib/internal/tool-operations/types'
import { TtsOperationError } from '@/lib/internal/tts/errors'
import {
  executeAzureTts,
  executeCartesiaTts,
  executeDeepgramTts,
  executeElevenLabsTts,
  executeGoogleTts,
  executeLegacyElevenLabsTts,
  executeOpenAiTts,
  executePlayHtTts,
  type TtsOperationContext,
} from '@/lib/internal/tts/operations'

const auth = {
  text: z
    .string({ error: 'Missing required fields: provider, text, and apiKey' })
    .min(1, 'Missing required fields: provider, text, and apiKey'),
  apiKey: z
    .string({ error: 'Missing required fields: provider, text, and apiKey' })
    .min(1, 'Missing required fields: provider, text, and apiKey'),
}

const schemas = {
  elevenlabs_tts: z.object({
    ...auth,
    voiceId: z.string().min(1),
    modelId: z.string().optional(),
    stability: z.coerce.number().min(0).max(1).optional(),
    similarityBoost: z.coerce.number().min(0).max(1).optional(),
  }),
  tts_openai: z.object({
    ...auth,
    model: z.enum(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']).optional(),
    voice: z.string().optional(),
    responseFormat: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
    speed: z.coerce.number().optional(),
  }),
  tts_deepgram: z.object({
    ...auth,
    model: z.string().optional(),
    voice: z.string().optional(),
    encoding: z.enum(['linear16', 'mp3', 'opus', 'aac', 'flac', 'mulaw', 'alaw']).optional(),
    sampleRate: z.coerce.number().optional(),
    bitRate: z.coerce.number().optional(),
    container: z.enum(['none', 'wav', 'ogg']).optional(),
  }),
  tts_elevenlabs: z.object({
    ...auth,
    voiceId: z.string().min(1),
    modelId: z.string().optional(),
    stability: z.coerce.number().optional(),
    similarityBoost: z.coerce.number().optional(),
    style: z.coerce.number().optional(),
    useSpeakerBoost: z.boolean().optional(),
  }),
  tts_cartesia: z.object({
    ...auth,
    modelId: z.string().optional(),
    voice: z.string().optional(),
    language: z.string().optional(),
    outputFormat: z
      .union([z.record(z.string(), z.unknown()), z.string()])
      .optional()
      .nullable(),
    speed: z.coerce.number().optional(),
    emotion: z.array(z.string()).optional(),
  }),
  tts_google: z.object({
    ...auth,
    voiceId: z.string().optional(),
    languageCode: z.string().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'NEUTRAL']).optional(),
    audioEncoding: z.enum(['LINEAR16', 'MP3', 'OGG_OPUS', 'MULAW', 'ALAW']).optional(),
    speakingRate: z.coerce.number().optional(),
    pitch: z.coerce.number().optional(),
    volumeGainDb: z.coerce.number().optional(),
    sampleRateHertz: z.coerce.number().optional(),
    effectsProfileId: z.array(z.string()).optional(),
  }),
  tts_azure: z.object({
    ...auth,
    voiceId: z.string().optional(),
    region: z
      .string()
      .regex(
        /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/,
        'region must be a valid Azure region identifier (e.g. eastus, westeurope)'
      )
      .optional(),
    outputFormat: z.string().optional(),
    rate: z.string().optional(),
    pitch: z.union([z.number(), z.string()]).optional(),
    style: z.union([z.number(), z.string()]).optional(),
    styleDegree: z.coerce.number().optional(),
    role: z.string().optional(),
  }),
  tts_playht: z.object({
    ...auth,
    userId: z.string().min(1),
    voice: z.string().optional(),
    quality: z.enum(['draft', 'standard', 'premium']).optional(),
    outputFormat: z.enum(['mp3', 'wav', 'ogg', 'flac', 'mulaw']).optional(),
    speed: z.coerce.number().optional(),
    temperature: z.coerce.number().optional(),
    voiceGuidance: z.coerce.number().optional(),
    textGuidance: z.coerce.number().optional(),
    sampleRate: z.coerce.number().optional(),
  }),
} as const

type TtsToolId = keyof typeof schemas

function isTtsToolId(toolId: string): toolId is TtsToolId {
  return Object.hasOwn(schemas, toolId)
}

function requiredInputError(toolId: TtsToolId, input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const value = input as Record<string, unknown>
  if (toolId === 'elevenlabs_tts') {
    if (!value.text || !value.voiceId || !value.apiKey) return 'Missing required parameters'
    return undefined
  }
  if (toolId === 'tts_elevenlabs' && !value.voiceId) {
    return 'voiceId is required for ElevenLabs provider'
  }
  if (toolId === 'tts_playht' && !value.userId) {
    return 'userId is required for PlayHT provider'
  }
  return undefined
}

async function executeOperation<I>(
  schema: z.ZodType<I>,
  request: InternalToolOperationCall,
  execute: (input: I, context: TtsOperationContext) => Promise<unknown>,
  legacy = false
): Promise<Response> {
  request.signal?.throwIfAborted()
  const requiredError = requiredInputError(request.toolId as TtsToolId, request.input)
  if (requiredError) return Response.json({ error: requiredError }, { status: 400 })
  const parsed = schema.safeParse(request.input)
  if (!parsed.success) {
    const error = getValidationErrorMessage(
      parsed.error,
      legacy ? 'Missing required parameters' : 'Invalid request data'
    )
    return Response.json(legacy ? { error } : { error, details: parsed.error.issues }, {
      status: 400,
    })
  }
  const userId = request.context.userId
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    const result = await execute(parsed.data, {
      requestId: request.requestId,
      signal: request.signal,
      userId,
      workspaceId: request.context.workspaceId,
      workflowId: request.context.workflowId,
      executionId: request.context.executionId,
    })
    request.signal?.throwIfAborted()
    return Response.json(result)
  } catch (error) {
    request.signal?.throwIfAborted()
    if (error instanceof TtsOperationError) {
      return Response.json(error.body, { status: error.status })
    }
    const message = getErrorMessage(error, legacy ? 'Unknown error' : 'TTS synthesis failed')
    return Response.json(
      { error: legacy ? `Internal Server Error: ${message}` : message },
      { status: isPayloadSizeLimitError(error) ? 413 : 500 }
    )
  }
}

export const executeTtsTool: InternalToolOperationHandler = async (request) => {
  request.signal?.throwIfAborted()
  if (!request.context.userId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!isTtsToolId(request.toolId)) {
    return Response.json({ error: `Unsupported TTS tool: ${request.toolId}` }, { status: 500 })
  }
  switch (request.toolId) {
    case 'elevenlabs_tts':
      return executeOperation(schemas.elevenlabs_tts, request, executeLegacyElevenLabsTts, true)
    case 'tts_openai':
      return executeOperation(schemas.tts_openai, request, executeOpenAiTts)
    case 'tts_deepgram':
      return executeOperation(schemas.tts_deepgram, request, executeDeepgramTts)
    case 'tts_elevenlabs':
      return executeOperation(schemas.tts_elevenlabs, request, executeElevenLabsTts)
    case 'tts_cartesia':
      return executeOperation(schemas.tts_cartesia, request, executeCartesiaTts)
    case 'tts_google':
      return executeOperation(schemas.tts_google, request, executeGoogleTts)
    case 'tts_azure':
      return executeOperation(schemas.tts_azure, request, executeAzureTts)
    case 'tts_playht':
      return executeOperation(schemas.tts_playht, request, executePlayHtTts)
  }
}
