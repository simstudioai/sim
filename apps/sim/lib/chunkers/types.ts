export interface ChunkMetadata {
  startIndex: number
  endIndex: number
  tokenCount: number
}

export interface TextChunk {
  text: string
  metadata: ChunkMetadata
}

export interface ChunkerOptions {
  chunkSize?: number
  minChunkSize?: number
  overlap?: number
}

export interface Chunk {
  text: string
  tokenCount: number
  metadata: {
    startIndex: number
    endIndex: number
  }
}

export interface StructuredDataOptions {
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
