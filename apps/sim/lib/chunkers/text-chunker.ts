import type { Chunk, ChunkerOptions } from '@/lib/chunkers/types'

/**
 * Lightweight text chunker optimized for RAG applications
 * Uses hierarchical splitting with simple character-based token estimation
 *
 * Parameters:
 * - chunkSize: Maximum chunk size in TOKENS (default: 1024)
 * - chunkOverlap: Overlap between chunks in TOKENS (default: 0)
 * - minCharactersPerChunk: Minimum characters to keep a chunk (default: 100)
 */
export class TextChunker {
  private readonly chunkSize: number // Max chunk size in tokens
  private readonly chunkOverlap: number // Overlap in tokens
  private readonly minCharactersPerChunk: number // Min characters per chunk

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
    this.chunkSize = options.chunkSize ?? 1024
    // Clamp overlap to prevent exceeding chunk size (max 50% of chunk size)
    const maxOverlap = Math.floor(this.chunkSize * 0.5)
    this.chunkOverlap = Math.min(options.chunkOverlap ?? 0, maxOverlap)
    this.minCharactersPerChunk = options.minCharactersPerChunk ?? 100
  }

  /**
   * Simple token estimation using character count
   * 1 token ≈ 4 characters for English text
   */
  private estimateTokens(text: string): number {
    if (!text?.trim()) return 0
    return Math.ceil(text.length / 4)
  }

  /**
   * Convert tokens to approximate character count
   */
  private tokensToChars(tokens: number): number {
    return tokens * 4
  }

  /**
   * Split text recursively using hierarchical separators
   */
  private async splitRecursively(text: string, separatorIndex = 0): Promise<string[]> {
    const tokenCount = this.estimateTokens(text)

    // If chunk is small enough (within max token limit), return it
    // Keep chunks even if below minCharactersPerChunk to avoid data loss
    if (tokenCount <= this.chunkSize) {
      // Only filter out empty/whitespace-only text, not small chunks
      return text.trim() ? [text] : []
    }

    // If we've run out of separators, force split by character count
    if (separatorIndex >= this.separators.length) {
      const chunks: string[] = []
      const targetLength = Math.ceil((text.length * this.chunkSize) / tokenCount)

      for (let i = 0; i < text.length; i += targetLength) {
        const chunk = text.slice(i, i + targetLength).trim()
        // Keep all non-empty chunks to avoid data loss
        if (chunk) {
          chunks.push(chunk)
        }
      }
      return chunks
    }

    const separator = this.separators[separatorIndex]
    const parts = text.split(separator).filter((part) => part.trim())

    // If no split occurred, try next separator
    if (parts.length <= 1) {
      return await this.splitRecursively(text, separatorIndex + 1)
    }

    const chunks: string[] = []
    let currentChunk = ''

    for (const part of parts) {
      const testChunk = currentChunk + (currentChunk ? separator : '') + part

      if (this.estimateTokens(testChunk) <= this.chunkSize) {
        currentChunk = testChunk
      } else {
        // Save current chunk - keep even if below minCharactersPerChunk to avoid data loss
        if (currentChunk.trim()) {
          chunks.push(currentChunk.trim())
        }

        // If part itself is too large, split it further
        if (this.estimateTokens(part) > this.chunkSize) {
          const subChunks = await this.splitRecursively(part, separatorIndex + 1)
          for (const subChunk of subChunks) {
            chunks.push(subChunk)
          }
          currentChunk = ''
        } else {
          currentChunk = part
        }
      }
    }

    // Add final chunk if it exists - keep even if below minCharactersPerChunk to avoid data loss
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim())
    }

    return chunks
  }

  /**
   * Add overlap between chunks (overlap is in tokens, converted to characters)
   */
  private addOverlap(chunks: string[]): string[] {
    if (this.chunkOverlap <= 0 || chunks.length <= 1) {
      return chunks
    }

    const overlappedChunks: string[] = []
    // Convert token overlap to character overlap
    const overlapChars = this.tokensToChars(this.chunkOverlap)

    for (let i = 0; i < chunks.length; i++) {
      let chunk = chunks[i]

      // Add overlap from previous chunk (converted from tokens to characters)
      if (i > 0) {
        const prevChunk = chunks[i - 1]
        // Take the last N characters from previous chunk (based on token overlap)
        const overlapLength = Math.min(overlapChars, prevChunk.length)
        const overlapText = prevChunk.slice(-overlapLength)

        // Try to start overlap at a word boundary for cleaner text
        const wordBoundaryMatch = overlapText.match(/^\s*\S/)
        const cleanOverlap = wordBoundaryMatch
          ? overlapText.slice(overlapText.indexOf(wordBoundaryMatch[0].trim()))
          : overlapText

        if (cleanOverlap.trim()) {
          chunk = `${cleanOverlap.trim()} ${chunk}`
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
    let chunks = await this.splitRecursively(cleanedText)

    // Add overlap if configured
    chunks = this.addOverlap(chunks)

    // Convert to Chunk objects with metadata
    let previousEndIndex = 0
    const chunkPromises = chunks.map(async (chunkText, index) => {
      let startIndex: number
      let actualContentLength: number

      if (index === 0 || this.chunkOverlap <= 0) {
        // First chunk or no overlap - start from previous end
        startIndex = previousEndIndex
        actualContentLength = chunkText.length
      } else {
        // Calculate overlap length in characters (converted from tokens)
        const prevChunk = chunks[index - 1]
        const overlapChars = this.tokensToChars(this.chunkOverlap)
        const overlapLength = Math.min(overlapChars, prevChunk.length, chunkText.length)

        startIndex = previousEndIndex - overlapLength
        actualContentLength = chunkText.length - overlapLength
      }

      const safeStart = Math.max(0, startIndex)
      const endIndexSafe = safeStart + Math.max(0, actualContentLength)

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

    return await Promise.all(chunkPromises)
  }
}
