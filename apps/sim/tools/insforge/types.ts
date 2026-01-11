import type { ToolResponse } from '@/tools/types'

// Database Query types
export interface InsForgeQueryParams {
  apiKey: string
  baseUrl: string
  table: string
  filter?: string
  orderBy?: string
  limit?: number
}

export interface InsForgeGetRowParams {
  apiKey: string
  baseUrl: string
  table: string
  filter: string
}

export interface InsForgeInsertParams {
  apiKey: string
  baseUrl: string
  table: string
  data: Record<string, unknown> | Record<string, unknown>[]
}

export interface InsForgeUpdateParams {
  apiKey: string
  baseUrl: string
  table: string
  filter: string
  data: Record<string, unknown>
}

export interface InsForgeDeleteParams {
  apiKey: string
  baseUrl: string
  table: string
  filter: string
}

export interface InsForgeUpsertParams {
  apiKey: string
  baseUrl: string
  table: string
  data: Record<string, unknown> | Record<string, unknown>[]
}

// Base response type
export interface InsForgeBaseResponse extends ToolResponse {
  output: {
    message: string
    results: Record<string, unknown>[]
  }
  error?: string
}

export type InsForgeQueryResponse = InsForgeBaseResponse
export type InsForgeGetRowResponse = InsForgeBaseResponse
export type InsForgeInsertResponse = InsForgeBaseResponse
export type InsForgeUpdateResponse = InsForgeBaseResponse
export type InsForgeDeleteResponse = InsForgeBaseResponse
export type InsForgeUpsertResponse = InsForgeBaseResponse

// Storage types
export interface InsForgeStorageUploadParams {
  apiKey: string
  baseUrl: string
  bucket: string
  path: string
  fileContent: string
  contentType?: string
  upsert?: boolean
}

export type InsForgeStorageUploadResponse = InsForgeBaseResponse

export interface InsForgeStorageDownloadParams {
  apiKey: string
  baseUrl: string
  bucket: string
  path: string
  fileName?: string
}

export interface InsForgeStorageDownloadResponse extends ToolResponse {
  output: {
    file: {
      name: string
      mimeType: string
      data: string | Buffer
      size: number
    }
  }
  error?: string
}

export interface InsForgeStorageListParams {
  apiKey: string
  baseUrl: string
  bucket: string
  path?: string
  limit?: number
  offset?: number
}

export type InsForgeStorageListResponse = InsForgeBaseResponse

export interface InsForgeStorageDeleteParams {
  apiKey: string
  baseUrl: string
  bucket: string
  paths: string[]
}

export type InsForgeStorageDeleteResponse = InsForgeBaseResponse

// Functions types
export interface InsForgeInvokeParams {
  apiKey: string
  baseUrl: string
  functionName: string
  body?: Record<string, unknown>
}

export type InsForgeInvokeResponse = InsForgeBaseResponse

// AI Completion types
export interface InsForgeCompletionParams {
  apiKey: string
  baseUrl: string
  model?: string
  messages: Array<{
    role: 'system' | 'user' | 'assistant'
    content: string
  }>
  temperature?: number
  maxTokens?: number
}

export interface InsForgeCompletionResponse extends ToolResponse {
  output: {
    message: string
    content: string
    usage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
  }
  error?: string
}

// AI Vision types
export interface InsForgeVisionParams {
  apiKey: string
  baseUrl: string
  model?: string
  prompt: string
  imageUrl: string
  maxTokens?: number
}

export interface InsForgeVisionResponse extends ToolResponse {
  output: {
    message: string
    content: string
    usage?: {
      promptTokens: number
      completionTokens: number
      totalTokens: number
    }
  }
  error?: string
}

// AI Image Generation types
export interface InsForgeImageGenerationParams {
  apiKey: string
  baseUrl: string
  model?: string
  prompt: string
  size?: string
  quality?: string
  n?: number
}

export interface InsForgeImageGenerationResponse extends ToolResponse {
  output: {
    message: string
    images: Array<{
      url: string
      revisedPrompt?: string
    }>
  }
  error?: string
}
