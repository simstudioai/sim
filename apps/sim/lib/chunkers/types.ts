/**
 * Units:
 * - chunkSize/chunkOverlap: TOKENS (1 token ≈ 4 characters)
 * - minCharactersPerChunk: CHARACTERS
 */
export interface ChunkerOptions {
  chunkSize?: number
  chunkOverlap?: number
  minCharactersPerChunk?: number
}

export interface Chunk {
  text: string
  tokenCount: number
  metadata: {
    startIndex: number
    endIndex: number
  }
}

export interface StructuredDataOptions extends ChunkerOptions {
  headers?: string[]
  totalRows?: number
  sheetName?: string
}

export interface DocChunk {
  text: string
  tokenCount: number
  sourceDocument: string
  headerLink: string
  headerText: string
  headerLevel: number
  embedding: number[]
  embeddingModel: string
  metadata: {
    sourceUrl?: string
    headers?: string[]
    title?: string
    startIndex: number
    endIndex: number
  }
}

export interface DocsChunkerOptions extends ChunkerOptions {
  baseUrl?: string
}

export type ChunkingStrategy = 'auto' | 'text' | 'regex' | 'recursive' | 'sentence' | 'token'

export type RecursiveRecipe = 'plain' | 'markdown' | 'code'

export interface StrategyOptions {
  pattern?: string
  separators?: string[]
  recipe?: RecursiveRecipe
}

export interface SentenceChunkerOptions extends ChunkerOptions {
  minSentencesPerChunk?: number
}

export interface RecursiveChunkerOptions extends ChunkerOptions {
  separators?: string[]
  recipe?: RecursiveRecipe
}

export interface RegexChunkerOptions extends ChunkerOptions {
  pattern: string
}
