import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

interface HiggsfieldAuthParams {
  accessToken: string
}

export interface HiggsfieldGenerationParams extends HiggsfieldAuthParams {
  waitForCompletion?: boolean
  webhookUrl?: string
  idempotencyKey?: string
  expiresAfter?: number
}

export interface HiggsfieldGenerateParams extends HiggsfieldGenerationParams {
  model: string
  input: Record<string, unknown> | string
}

export interface HiggsfieldGenerateSoulImageParams extends HiggsfieldGenerationParams {
  prompt: string
  aspectRatio?: string
  resolution?: string
  batchSize?: number
  styleId?: string
  styleStrength?: number
  characterId?: string
  characterStrength?: number
  imageReferenceUrl?: string
  enhancePrompt?: boolean
  seed?: number
}

export interface HiggsfieldRequestIdParams extends HiggsfieldAuthParams {
  requestId: string
}

export interface HiggsfieldCreateCharacterParams extends HiggsfieldAuthParams {
  name: string
  modelVersion?: string
  imageUrls: string[] | string
}

export interface HiggsfieldCharacterIdParams extends HiggsfieldAuthParams {
  characterId: string
}

export interface HiggsfieldListCharactersParams extends HiggsfieldAuthParams {
  page?: number
  pageSize?: number
}

export interface HiggsfieldRequestOutput {
  requestId: string
  status: string
  error: string | null
  imageUrls: string[]
  videoUrl: string | null
  audioUrl: string | null
  audioUrls: string[]
  statusUrl: string | null
  cancelUrl: string | null
  expiresAt: string | null
}

export interface HiggsfieldCharacter {
  id: string
  name: string | null
  modelVersion: string | null
  status: string | null
  thumbnailUrl: string | null
  createdAt: string | null
  inProgressAt: string | null
  failReason: string | null
}

export interface HiggsfieldRequestResponse extends ToolResponse {
  output: HiggsfieldRequestOutput
}

export interface HiggsfieldCancelRequestResponse extends ToolResponse {
  output: { requestId: string; canceled: boolean }
}

export interface HiggsfieldDeleteRequestResponse extends ToolResponse {
  output: { requestId: string; deleted: boolean }
}

export interface HiggsfieldCharacterResponse extends ToolResponse {
  output: { character: HiggsfieldCharacter }
}

export interface HiggsfieldListCharactersResponse extends ToolResponse {
  output: {
    characters: HiggsfieldCharacter[]
    total: number | null
    page: number | null
    pageSize: number | null
    totalPages: number | null
  }
}

export interface HiggsfieldDeleteCharacterResponse extends ToolResponse {
  output: { characterId: string; deleted: boolean }
}

export const HIGGSFIELD_REQUEST_OUTPUTS = {
  requestId: { type: 'string', description: 'Higgsfield request ID' },
  status: {
    type: 'string',
    description: 'Request status: queued, in_progress, completed, failed, nsfw, or canceled',
  },
  error: { type: 'string', description: 'Failure reason, when provided', optional: true },
  imageUrls: {
    type: 'array',
    description: 'Generated image URLs (image models)',
    items: { type: 'string', description: 'Image URL' },
  },
  videoUrl: { type: 'string', description: 'Generated video URL (video models)', optional: true },
  audioUrl: { type: 'string', description: 'Generated audio URL (audio output)', optional: true },
  audioUrls: {
    type: 'array',
    description: 'Generated audio URLs (audio output)',
    items: { type: 'string', description: 'Audio URL' },
  },
  statusUrl: { type: 'string', description: 'URL for checking the request status', optional: true },
  cancelUrl: {
    type: 'string',
    description: 'URL for canceling the queued request',
    optional: true,
  },
  expiresAt: {
    type: 'string',
    description: 'When the output files are deleted and their URLs stop working',
    optional: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const HIGGSFIELD_CHARACTER_PROPERTIES = {
  id: { type: 'string', description: 'Character (Soul ID) reference ID' },
  name: { type: 'string', description: 'Character name' },
  modelVersion: { type: 'string', description: 'SOUL family: v1, v2, or cinema' },
  status: {
    type: 'string',
    description: 'Training status: not_ready, queued, in_progress, completed, or failed',
  },
  thumbnailUrl: { type: 'string', description: 'Thumbnail image URL', optional: true },
  createdAt: { type: 'string', description: 'Creation timestamp', optional: true },
  inProgressAt: { type: 'string', description: 'Training start timestamp', optional: true },
  failReason: { type: 'string', description: 'Training failure reason', optional: true },
} as const satisfies Record<string, ToolOutputProperty>
