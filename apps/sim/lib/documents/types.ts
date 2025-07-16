export interface DocChunk {
  /** The chunk text content */
  text: string
  /** Token count estimate for the chunk */
  tokenCount: number
  /** Source document path relative to docs/ */
  sourceDocument: string
  /** Link to the most relevant header section */
  headerLink: string
  /** The header text that this chunk belongs to */
  headerText: string
  /** Header level (1-6) */
  headerLevel: number
  /** OpenAI text embedding vector (1536 dimensions for text-embedding-3-small) */
  embedding: number[]
  /** Model used to generate the embedding */
  embeddingModel: string
  /** Metadata about the chunk */
  metadata: {
    /** Start position in the original document */
    startIndex: number
    /** End position in the original document */
    endIndex: number
    /** Whether this chunk contains the document frontmatter */
    hasFrontmatter?: boolean
    /** Document title from frontmatter */
    documentTitle?: string
    /** Document description from frontmatter */
    documentDescription?: string
  }
}

export interface DocsChunkerOptions {
  /** Target chunk size in tokens */
  chunkSize?: number
  /** Minimum chunk size in tokens */
  minChunkSize?: number
  /** Overlap between chunks in tokens */
  overlap?: number
  /** Base URL for generating links */
  baseUrl?: string
}

export interface HeaderInfo {
  /** Header text */
  text: string
  /** Header level (1-6) */
  level: number
  /** Anchor link */
  anchor: string
  /** Position in document */
  position: number
}
