/**
 * Options for configuring text chunkers
 *
 * Units:
 * - chunkSize: Maximum chunk size in TOKENS
 *   - For OpenAI: 1 token ≈ 4 characters
 *   - For Ollama: 1 token ≈ 3 characters (conservative estimate)
 * - chunkOverlap: Overlap between chunks in TOKENS
 * - minCharactersPerChunk: Minimum chunk size in CHARACTERS (filters tiny fragments)
 */
export interface ChunkerOptions {
  /** Maximum chunk size in tokens (default: 1024) */
  chunkSize?: number
  /** Overlap between chunks in tokens (default: 0) */
  chunkOverlap?: number
  /** Minimum chunk size in characters to avoid tiny fragments (default: 100) */
  minCharactersPerChunk?: number
  /** Embedding model to use for accurate token estimation (optional) */
  embeddingModel?: string
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
