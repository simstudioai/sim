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

/**
 * Lightweight text chunker optimized for RAG applications
 * Uses hierarchical splitting with smart token estimation
 */
export class TextChunker {
  private readonly chunkSize: number
  private readonly minChunkSize: number
  private readonly overlap: number

  // Hierarchical separators ordered from largest to smallest semantic units
  private readonly separators = [
    '\n\n\n', // Document sections
    '\n---\n', // Markdown horizontal rules
    '\n***\n', // Markdown horizontal rules (alternative)
    '\n___\n', // Markdown horizontal rules (alternative)
    '\n# ', // Markdown H1 headings
    '\n## ', // Markdown H2 headings
    '\n### ', // Markdown H3 headings
    '\n#### ', // Markdown H4 headings
    '\n##### ', // Markdown H5 headings
    '\n###### ', // Markdown H6 headings
    '\n\n', // Paragraphs
    '\n', // Lines
    '. ', // Sentences
    '! ', // Exclamations
    '? ', // Questions
    '; ', // Semicolons
    ', ', // Commas
    ' ', // Words
  ]

  constructor(options: ChunkerOptions = {}) {
    this.chunkSize = options.chunkSize ?? 512
    this.minChunkSize = options.minChunkSize ?? 1
    this.overlap = options.overlap ?? 0
  }

  /**
   * Estimate token count - optimized for common tokenizers
   */
  private estimateTokens(text: string): number {
    // Handle empty or whitespace-only text
    if (!text?.trim()) return 0

    const words = text.trim().split(/\s+/)
    let tokenCount = 0

    for (const word of words) {
      if (word.length === 0) continue

      // Short words (1-4 chars) are usually 1 token
      if (word.length <= 4) {
        tokenCount += 1
      }
      // Medium words (5-8 chars) are usually 1-2 tokens
      else if (word.length <= 8) {
        tokenCount += Math.ceil(word.length / 5)
      }
      // Long words get split more by subword tokenization
      else {
        tokenCount += Math.ceil(word.length / 4)
      }
    }

    return tokenCount
  }

  /**
   * Split text recursively using hierarchical separators
   */
  private splitRecursively(text: string, separatorIndex = 0): string[] {
    const tokenCount = this.estimateTokens(text)

    // If chunk is small enough, return it
    if (tokenCount <= this.chunkSize) {
      return text.length >= this.minChunkSize ? [text] : []
    }

    // If we've run out of separators, force split by character count
    if (separatorIndex >= this.separators.length) {
      const chunks: string[] = []
      const targetLength = Math.ceil((text.length * this.chunkSize) / tokenCount)

      for (let i = 0; i < text.length; i += targetLength) {
        const chunk = text.slice(i, i + targetLength).trim()
        if (chunk.length >= this.minChunkSize) {
          chunks.push(chunk)
        }
      }
      return chunks
    }

    const separator = this.separators[separatorIndex]
    const parts = text.split(separator).filter((part) => part.trim())

    // If no split occurred, try next separator
    if (parts.length <= 1) {
      return this.splitRecursively(text, separatorIndex + 1)
    }

    const chunks: string[] = []
    let currentChunk = ''

    for (const part of parts) {
      const testChunk = currentChunk + (currentChunk ? separator : '') + part

      if (this.estimateTokens(testChunk) <= this.chunkSize) {
        currentChunk = testChunk
      } else {
        // Save current chunk if it meets minimum size
        if (currentChunk.trim() && currentChunk.length >= this.minChunkSize) {
          chunks.push(currentChunk.trim())
        }

        // Start new chunk with current part
        // If part itself is too large, split it further
        if (this.estimateTokens(part) > this.chunkSize) {
          chunks.push(...this.splitRecursively(part, separatorIndex + 1))
          currentChunk = ''
        } else {
          currentChunk = part
        }
      }
    }

    // Add final chunk if it exists and meets minimum size
    if (currentChunk.trim() && currentChunk.length >= this.minChunkSize) {
      chunks.push(currentChunk.trim())
    }

    return chunks
  }

  /**
   * Add overlap between chunks if specified
   */
  private addOverlap(chunks: string[]): string[] {
    if (this.overlap <= 0 || chunks.length <= 1) {
      return chunks
    }

    const overlappedChunks: string[] = []

    for (let i = 0; i < chunks.length; i++) {
      let chunk = chunks[i]

      // Add overlap from previous chunk
      if (i > 0) {
        const prevChunk = chunks[i - 1]
        const words = prevChunk.split(/\s+/)
        const overlapWords = words.slice(-Math.min(this.overlap, words.length))

        if (overlapWords.length > 0) {
          chunk = `${overlapWords.join(' ')} ${chunk}`
        }
      }

      overlappedChunks.push(chunk)
    }

    return overlappedChunks
  }

  /**
   * Clean and normalize text
   */
  private cleanText(text: string): string {
    return text
      .replace(/\r\n/g, '\n') // Normalize Windows line endings
      .replace(/\r/g, '\n') // Normalize old Mac line endings
      .replace(/\n{3,}/g, '\n\n') // Limit consecutive newlines
      .replace(/\t/g, ' ') // Convert tabs to spaces
      .replace(/ {2,}/g, ' ') // Collapse multiple spaces
      .trim()
  }

  /**
   * Main chunking method
   */
  async chunk(text: string): Promise<Chunk[]> {
    if (!text?.trim()) {
      return []
    }

    // Clean the text
    const cleanedText = this.cleanText(text)

    // Split into chunks
    let chunks = this.splitRecursively(cleanedText)

    // Add overlap if configured
    chunks = this.addOverlap(chunks)

    // Convert to Chunk objects with metadata
    let previousEndIndex = 0
    return chunks.map((chunkText, index) => {
      let startIndex: number
      let actualContentLength: number

      if (index === 0 || this.overlap <= 0) {
        // First chunk or no overlap - start from previous end
        startIndex = previousEndIndex
        actualContentLength = chunkText.length
      } else {
        // Calculate overlap length in characters
        const prevChunk = chunks[index - 1]
        const prevWords = prevChunk.split(/\s+/)
        const overlapWords = prevWords.slice(-Math.min(this.overlap, prevWords.length))
        const overlapLength = Math.min(
          chunkText.length,
          overlapWords.length > 0 ? overlapWords.join(' ').length + 1 : 0 // +1 for space
        )

        startIndex = previousEndIndex - overlapLength
        actualContentLength = chunkText.length - overlapLength
      }

      const safeStart = Math.max(0, startIndex)
      const endIndexSafe = safeStart + actualContentLength

      const chunk: Chunk = {
        text: chunkText,
        tokenCount: this.estimateTokens(chunkText),
        metadata: {
          startIndex: safeStart,
          endIndex: endIndexSafe,
        },
      }

      previousEndIndex = endIndexSafe
      return chunk
    })
  }
}
