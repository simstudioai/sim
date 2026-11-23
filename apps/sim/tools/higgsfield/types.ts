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
  error: { type: 'string', description: 'Failure reason, when provided', nullable: true },
  imageUrls: {
    type: 'array',
    description: 'Generated image URLs (image models)',
    items: { type: 'string', description: 'Image URL' },
  },
  videoUrl: { type: 'string', description: 'Generated video URL (video models)', nullable: true },
  audioUrl: { type: 'string', description: 'Generated audio URL (audio output)', nullable: true },
  audioUrls: {
    type: 'array',
    description: 'Generated audio URLs (audio output)',
    items: { type: 'string', description: 'Audio URL' },
  },
  statusUrl: { type: 'string', description: 'URL for checking the request status', nullable: true },
  cancelUrl: {
    type: 'string',
    description: 'URL for canceling the queued request',
    nullable: true,
  },
  expiresAt: {
    type: 'string',
    description: 'When the output files are deleted and their URLs stop working',
    nullable: true,
  },
} as const satisfies Record<string, ToolOutputProperty>

export const HIGGSFIELD_CHARACTER_PROPERTIES = {
  id: { type: 'string', description: 'Character (Soul ID) reference ID' },
  name: { type: 'string', description: 'Character name', nullable: true },
  modelVersion: { type: 'string', description: 'SOUL family: v1, v2, or cinema', nullable: true },
  status: {
    type: 'string',
    description: 'Training status: not_ready, queued, in_progress, completed, or failed',
    nullable: true,
  },
  thumbnailUrl: { type: 'string', description: 'Thumbnail image URL', nullable: true },
  createdAt: { type: 'string', description: 'Creation timestamp', nullable: true },
  inProgressAt: { type: 'string', description: 'Training start timestamp', nullable: true },
  failReason: { type: 'string', description: 'Training failure reason', nullable: true },
} as const satisfies Record<string, ToolOutputProperty>
