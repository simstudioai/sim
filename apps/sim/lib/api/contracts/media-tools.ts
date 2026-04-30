import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema, RawFileInputSchema } from '@/lib/uploads/utils/file-schemas'

const AWS_REGION_PATTERN =
  /^(eu-isoe|us-isob|us-iso|us-gov|af|ap|ca|cn|eu|il|me|mx|sa|us)-(central|north|northeast|northwest|south|southeast|southwest|east|west)-\d{1,2}$/

export const mediaToolRawFlowExceptions = [
  {
    path: '/api/tools/image',
    method: 'GET',
    boundary: 'external-origin-binary-proxy',
    reason:
      'Proxies a validated external image origin and returns the upstream binary image bytes.',
  },
  {
    path: '/api/proxy/tts/stream',
    method: 'POST',
    boundary: 'stream',
    reason: 'Streams audio bytes from ElevenLabs through a readable stream with audio headers.',
  },
  {
    path: '/api/files/upload',
    method: 'POST',
    boundary: 'multipart',
    reason: 'Accepts browser multipart/form-data file uploads instead of a JSON body.',
  },
  {
    path: '/api/files/multipart',
    method: 'POST',
    boundary: 'multipart-signed-url',
    reason: 'Coordinates cloud multipart upload tokens and signed part URLs.',
  },
  {
    path: '/api/files/presigned',
    method: 'POST',
    boundary: 'signed-url',
    reason: 'Returns provider-specific signed upload URLs and upload headers.',
  },
  {
    path: '/api/files/presigned/batch',
    method: 'POST',
    boundary: 'signed-url',
    reason: 'Returns batches of provider-specific signed upload URLs and upload headers.',
  },
  {
    path: '/api/files/serve/[...path]',
    method: 'GET',
    boundary: 'binary',
    reason: 'Serves stored file bytes with content-specific response headers.',
  },
] as const

export const imageProxyQuerySchema = z.object({
  url: z.string({ error: 'Missing URL parameter' }).min(1, 'Missing URL parameter'),
})

export const visionAnalyzeBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  imageUrl: z.string().optional().nullable(),
  imageFile: RawFileInputSchema.optional().nullable(),
  model: z.string().optional().default('gpt-5.2'),
  prompt: z.string().optional().nullable(),
})

export const videoProviders = ['runway', 'veo', 'luma', 'minimax', 'falai'] as const
const MISSING_VIDEO_FIELDS_ERROR = 'Missing required fields: provider, apiKey, and prompt'

export const mediaUserFileSchema = z
  .object({
    id: z.string().optional().default(''),
    name: z.string().min(1),
    url: z.string().optional().default(''),
    size: z.coerce.number().nonnegative(),
    type: z.string().optional().default('application/octet-stream'),
    key: z.string().min(1),
    context: z.string().optional(),
    base64: z.string().optional(),
  })
  .passthrough()

export const videoToolBodySchema = z
  .object({
    provider: z
      .string({ error: MISSING_VIDEO_FIELDS_ERROR })
      .min(1, MISSING_VIDEO_FIELDS_ERROR)
      .refine((provider) => videoProviders.includes(provider as (typeof videoProviders)[number]), {
        message: `Invalid provider. Must be one of: ${videoProviders.join(', ')}`,
      }),
    apiKey: z.string({ error: MISSING_VIDEO_FIELDS_ERROR }).min(1, MISSING_VIDEO_FIELDS_ERROR),
    model: z.string().optional(),
    prompt: z.string({ error: MISSING_VIDEO_FIELDS_ERROR }).min(1, MISSING_VIDEO_FIELDS_ERROR),
    duration: z.coerce.number().optional(),
    aspectRatio: z.string().optional(),
    resolution: z.string().optional(),
    visualReference: mediaUserFileSchema.optional(),
    cameraControl: z.unknown().optional(),
    endpoint: z.string().optional(),
    promptOptimizer: z.boolean().optional(),
    workspaceId: z.string().optional(),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
    userId: z.string().optional(),
  })
  .passthrough()

export const sttProviders = ['whisper', 'deepgram', 'elevenlabs', 'assemblyai', 'gemini'] as const
const MISSING_STT_FIELDS_ERROR = 'Missing required fields: provider and apiKey'

export const sttUserFileSchema = mediaUserFileSchema.extend({
  type: z.string().optional().default(''),
})

export const sttUserFileInputSchema = z.union([sttUserFileSchema, z.array(sttUserFileSchema)])

export const sttToolBodySchema = z
  .object({
    provider: z
      .string({ error: MISSING_STT_FIELDS_ERROR })
      .min(1, MISSING_STT_FIELDS_ERROR)
      .refine((provider) => sttProviders.includes(provider as (typeof sttProviders)[number]), {
        message: `Invalid provider. Must be one of: ${sttProviders.join(', ')}`,
      }),
    apiKey: z.string({ error: MISSING_STT_FIELDS_ERROR }).min(1, MISSING_STT_FIELDS_ERROR),
    model: z.string().optional(),
    audioFile: sttUserFileInputSchema.optional(),
    audioFileReference: sttUserFileInputSchema.optional(),
    audioUrl: z.string().optional(),
    language: z.string().optional(),
    timestamps: z.enum(['none', 'sentence', 'word']).optional(),
    diarization: z.boolean().optional(),
    translateToEnglish: z.boolean().optional(),
    prompt: z.string().optional(),
    temperature: z.coerce.number().optional(),
    sentiment: z.boolean().optional(),
    entityDetection: z.boolean().optional(),
    piiRedaction: z.boolean().optional(),
    summarization: z.boolean().optional(),
    workspaceId: z.string().optional(),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
  })
  .passthrough()

export const ttsToolBodySchema = z.object({
  text: z.string({ error: 'Missing required parameters' }).min(1, 'Missing required parameters'),
  voiceId: z.string({ error: 'Missing required parameters' }).min(1, 'Missing required parameters'),
  apiKey: z.string({ error: 'Missing required parameters' }).min(1, 'Missing required parameters'),
  modelId: z.string().optional().default('eleven_monolingual_v1'),
  workspaceId: z.string().optional(),
  workflowId: z.string().optional(),
  executionId: z.string().optional(),
})

export const ttsStreamBodySchema = z
  .object({
    text: z.string().min(1),
    voiceId: z.string().min(1),
    modelId: z.string().optional().default('eleven_turbo_v2_5'),
    chatId: z.string().min(1),
  })
  .passthrough()

export const ttsOutputFormatSchema = z.union([z.record(z.string(), z.unknown()), z.string()])
export const playHtOutputFormatSchema = z.enum(['mp3', 'wav', 'ogg', 'flac', 'mulaw'])

export const ttsUnifiedToolBodySchema = z
  .object({
    provider: z.enum(
      ['openai', 'deepgram', 'elevenlabs', 'cartesia', 'google', 'azure', 'playht'],
      {
        error: 'Missing required fields: provider, text, and apiKey',
      }
    ),
    text: z
      .string({ error: 'Missing required fields: provider, text, and apiKey' })
      .min(1, 'Missing required fields: provider, text, and apiKey'),
    apiKey: z
      .string({ error: 'Missing required fields: provider, text, and apiKey' })
      .min(1, 'Missing required fields: provider, text, and apiKey'),
    model: z.enum(['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']).optional(),
    voice: z.string().optional(),
    responseFormat: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional(),
    speed: z.coerce.number().optional(),
    encoding: z.enum(['linear16', 'mp3', 'opus', 'aac', 'flac', 'mulaw', 'alaw']).optional(),
    sampleRate: z.coerce.number().optional(),
    bitRate: z.coerce.number().optional(),
    container: z.enum(['none', 'wav', 'ogg']).optional(),
    voiceId: z.string().optional(),
    modelId: z.string().optional(),
    stability: z.coerce.number().optional(),
    similarityBoost: z.coerce.number().optional(),
    style: z.union([z.coerce.number(), z.string()]).optional(),
    useSpeakerBoost: z.boolean().optional(),
    language: z.string().optional(),
    outputFormat: ttsOutputFormatSchema.optional().nullable(),
    emotion: z.array(z.string()).optional(),
    languageCode: z.string().optional(),
    gender: z.enum(['MALE', 'FEMALE', 'NEUTRAL']).optional(),
    audioEncoding: z.enum(['LINEAR16', 'MP3', 'OGG_OPUS', 'MULAW', 'ALAW']).optional(),
    speakingRate: z.coerce.number().optional(),
    pitch: z.union([z.number(), z.string()]).optional(),
    volumeGainDb: z.coerce.number().optional(),
    sampleRateHertz: z.coerce.number().optional(),
    effectsProfileId: z.array(z.string()).optional(),
    region: z.string().optional(),
    rate: z.string().optional(),
    styleDegree: z.coerce.number().optional(),
    role: z.string().optional(),
    userId: z.string().optional(),
    quality: z.enum(['draft', 'standard', 'premium']).optional(),
    temperature: z.coerce.number().optional(),
    voiceGuidance: z.coerce.number().optional(),
    textGuidance: z.coerce.number().optional(),
    workspaceId: z.string().optional(),
    workflowId: z.string().optional(),
    executionId: z.string().optional(),
  })
  .passthrough()

const textractQuerySchema = z.object({
  Text: z.string().min(1),
  Alias: z.string().optional(),
  Pages: z.array(z.string()).optional(),
})

export const textractParseBodySchema = z
  .object({
    accessKeyId: z.string().min(1, 'AWS Access Key ID is required'),
    secretAccessKey: z.string().min(1, 'AWS Secret Access Key is required'),
    region: z
      .string()
      .min(1, 'AWS region is required')
      .regex(
        AWS_REGION_PATTERN,
        'AWS region must be a valid AWS region (e.g., us-east-1, eu-west-2, us-gov-west-1)'
      ),
    processingMode: z.enum(['sync', 'async']).optional().default('sync'),
    filePath: z.string().optional(),
    file: RawFileInputSchema.optional(),
    s3Uri: z.string().optional(),
    featureTypes: z
      .array(z.enum(['TABLES', 'FORMS', 'QUERIES', 'SIGNATURES', 'LAYOUT']))
      .optional(),
    queries: z.array(textractQuerySchema).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.processingMode === 'async' && !data.s3Uri) {
      ctx.addIssue({
        code: 'custom',
        message: 'S3 URI is required for multi-page processing (s3://bucket/key)',
        path: ['s3Uri'],
      })
    }
    if (data.processingMode !== 'async' && !data.file && !data.filePath) {
      ctx.addIssue({
        code: 'custom',
        message: 'File input is required for single-page processing',
        path: ['filePath'],
      })
    }
  })

export const reductoParseBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  pages: z.array(z.number()).optional(),
  tableOutputFormat: z.enum(['html', 'md']).optional(),
})

export const pulseParseBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  pages: z.string().optional(),
  extractFigure: z.boolean().optional(),
  figureDescription: z.boolean().optional(),
  returnHtml: z.boolean().optional(),
  chunking: z.string().optional(),
  chunkSize: z.number().optional(),
})

export const extendParseBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().optional(),
  file: RawFileInputSchema.optional(),
  outputFormat: z.enum(['markdown', 'spatial']).optional(),
  chunking: z.enum(['page', 'document', 'section']).optional(),
  engine: z.enum(['parse_performance', 'parse_light']).optional(),
})

export const mistralParseBodySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
  filePath: z.string().min(1, 'File path is required').optional(),
  fileData: FileInputSchema.optional(),
  file: FileInputSchema.optional(),
  resultType: z.string().optional(),
  pages: z.array(z.number()).optional(),
  includeImageBase64: z.boolean().optional(),
  imageLimit: z.number().optional(),
  imageMinSize: z.number().optional(),
})

export const speechTokenBodySchema = z
  .object({
    chatId: z.string().optional(),
  })
  .passthrough()

export const fileManageQuerySchema = z.object({
  userId: z.string().min(1).nullable().optional(),
  workspaceId: z.string().min(1).nullable().optional(),
})

export const fileManageWriteBodySchema = z.object({
  operation: z.literal('write'),
  workspaceId: z.string().min(1).optional(),
  fileName: z.string({ error: 'fileName is required for write operation' }).min(1),
  content: z.string({ error: 'content is required for write operation' }),
  contentType: z.string().optional(),
})

export const fileManageAppendBodySchema = z.object({
  operation: z.literal('append'),
  workspaceId: z.string().min(1).optional(),
  fileName: z.string({ error: 'fileName is required for append operation' }).min(1),
  content: z.string({ error: 'content is required for append operation' }),
})

export const fileManageBodySchema = z.discriminatedUnion('operation', [
  fileManageWriteBodySchema,
  fileManageAppendBodySchema,
])

const toolJsonResponseSchema = z
  .object({
    success: z.boolean().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
    message: z.string().optional(),
    data: z.unknown().optional(),
  })
  .passthrough()

export const speechTokenResponseSchema = z.object({
  token: z.string(),
})

export const imageProxyContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/image',
  query: imageProxyQuerySchema,
  response: { mode: 'binary' },
})

export const visionAnalyzeContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/vision/analyze',
  body: visionAnalyzeBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const videoToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/video',
  body: videoToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const sttToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/stt',
  body: sttToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const ttsToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/tts',
  body: ttsToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const ttsUnifiedToolContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/tts/unified',
  body: ttsUnifiedToolBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const ttsStreamContract = defineRouteContract({
  method: 'POST',
  path: '/api/proxy/tts/stream',
  body: ttsStreamBodySchema,
  response: { mode: 'stream' },
})

export const textractParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/textract/parse',
  body: textractParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const reductoParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/reducto/parse',
  body: reductoParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const pulseParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/pulse/parse',
  body: pulseParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const extendParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/extend/parse',
  body: extendParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const mistralParseContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/mistral/parse',
  body: mistralParseBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})

export const speechTokenContract = defineRouteContract({
  method: 'POST',
  path: '/api/speech/token',
  body: speechTokenBodySchema,
  response: { mode: 'json', schema: speechTokenResponseSchema },
})

export const fileManageContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/file/manage',
  query: fileManageQuerySchema,
  body: fileManageBodySchema,
  response: { mode: 'json', schema: toolJsonResponseSchema },
})
