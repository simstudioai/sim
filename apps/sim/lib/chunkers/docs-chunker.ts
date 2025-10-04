import fs from 'fs/promises'
import path from 'path'
import { generateEmbeddings } from '@/lib/embeddings/utils'
import { createLogger } from '@/lib/logs/console/logger'
import { TextChunker } from './text-chunker'
import type { DocChunk, DocsChunkerOptions } from './types'

interface HeaderInfo {
  level: number
  text: string
  slug?: string
  anchor?: string
  position?: number
}

interface Frontmatter {
  title?: string
  description?: string
  [key: string]: any
}

const logger = createLogger('DocsChunker')

/**
 * Docs-specific chunker that processes .mdx files and tracks header context
 */
export class DocsChunker {
  private readonly textChunker: TextChunker
  private readonly baseUrl: string

  constructor(options: DocsChunkerOptions = {}) {
    // Use the existing TextChunker for chunking logic
    this.textChunker = new TextChunker({
      chunkSize: options.chunkSize ?? 300, // Max 300 tokens per chunk
      minChunkSize: options.minChunkSize ?? 1,
      overlap: options.overlap ?? 50,
    })
    // Use localhost docs in development, production docs otherwise
    this.baseUrl = options.baseUrl ?? 'https://docs.sim.ai'
  }

  /**
   * Process all .mdx files in the docs directory
   */
  async chunkAllDocs(docsPath: string): Promise<DocChunk[]> {
    const allChunks: DocChunk[] = []

    try {
      const mdxFiles = await this.findMdxFiles(docsPath)
      logger.info(`Found ${mdxFiles.length} .mdx files to process`)

      for (const filePath of mdxFiles) {
        try {
          const chunks = await this.chunkMdxFile(filePath, docsPath)
          allChunks.push(...chunks)
          logger.info(`Processed ${filePath}: ${chunks.length} chunks`)
        } catch (error) {
          logger.error(`Error processing ${filePath}:`, error)
        }
      }

      logger.info(`Total chunks generated: ${allChunks.length}`)
      return allChunks
    } catch (error) {
      logger.error('Error processing docs:', error)
      throw error
    }
  }

  /**
   * Process a single .mdx file
   */
  async chunkMdxFile(filePath: string, basePath: string): Promise<DocChunk[]> {
    const content = await fs.readFile(filePath, 'utf-8')
    const relativePath = path.relative(basePath, filePath)

    // Parse frontmatter and content
    const { data: frontmatter, content: markdownContent } = this.parseFrontmatter(content)

    // Extract headers from the content
    const headers = this.extractHeaders(markdownContent)

    // Generate document URL
    const documentUrl = this.generateDocumentUrl(relativePath)

    // Split content into chunks
    const textChunks = await this.splitContent(markdownContent)

    // Generate embeddings for all chunks at once (batch processing)
    logger.info(`Generating embeddings for ${textChunks.length} chunks in ${relativePath}`)
    const embeddings = textChunks.length > 0 ? await generateEmbeddings(textChunks) : []
    const embeddingModel = 'text-embedding-3-small'

    // Convert to DocChunk objects with header context and embeddings
    const chunks: DocChunk[] = []
    let currentPosition = 0

    for (let i = 0; i < textChunks.length; i++) {
      const chunkText = textChunks[i]
      const chunkStart = currentPosition
      const chunkEnd = currentPosition + chunkText.length

      // Find the most relevant header for this chunk
      const relevantHeader = this.findRelevantHeader(headers, chunkStart)

      const chunk: DocChunk = {
        text: chunkText,
        tokenCount: Math.ceil(chunkText.length / 4), // Simple token estimation
        sourceDocument: relativePath,
        headerLink: relevantHeader ? `${documentUrl}#${relevantHeader.anchor}` : documentUrl,
        headerText: relevantHeader?.text || frontmatter.title || 'Document Root',
        headerLevel: relevantHeader?.level || 1,
        embedding: embeddings[i] || [],
        embeddingModel,
        metadata: {
          startIndex: chunkStart,
          endIndex: chunkEnd,
          title: frontmatter.title,
        },
      }

      chunks.push(chunk)
      currentPosition = chunkEnd
    }

    return chunks
  }

  /**
   * Find all .mdx files recursively
   */
  private async findMdxFiles(dirPath: string): Promise<string[]> {
    const files: string[] = []

    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        const subFiles = await this.findMdxFiles(fullPath)
        files.push(...subFiles)
      } else if (entry.isFile() && entry.name.endsWith('.mdx')) {
        files.push(fullPath)
      }
    }

    return files
  }

  /**
   * Extract headers and their positions from markdown content
   */
  private extractHeaders(content: string): HeaderInfo[] {
    const headers: HeaderInfo[] = []
    const headerRegex = /^(#{1,6})\s+(.+)$/gm
    let match

    while ((match = headerRegex.exec(content)) !== null) {
      const level = match[1].length
      const text = match[2].trim()
      const anchor = this.generateAnchor(text)

      headers.push({
        text,
        level,
        anchor,
        position: match.index,
      })
    }

    return headers
  }

  /**
   * Generate URL-safe anchor from header text
   */
  private generateAnchor(headerText: string): string {
    return headerText
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/-+/g, '-') // Replace multiple hyphens with single
      .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
  }

  /**
   * Generate document URL from relative path
   */
  private generateDocumentUrl(relativePath: string): string {
    // Convert file path to URL path
    // e.g., "tools/knowledge.mdx" -> "/tools/knowledge"
    const urlPath = relativePath.replace(/\.mdx$/, '').replace(/\\/g, '/') // Handle Windows paths

    return `${this.baseUrl}/${urlPath}`
  }

  /**
   * Find the most relevant header for a given position
   */
  private findRelevantHeader(headers: HeaderInfo[], position: number): HeaderInfo | null {
    if (headers.length === 0) return null

    // Find the last header that comes before this position
    let relevantHeader: HeaderInfo | null = null

    for (const header of headers) {
      if (header.position !== undefined && header.position <= position) {
        relevantHeader = header
      } else {
        break
      }
    }

    return relevantHeader
  }

  /**
   * Split content into chunks using the existing TextChunker with table awareness
   */
  private async splitContent(content: string): Promise<string[]> {
    // Clean the content first
    const cleanedContent = this.cleanContent(content)

    // Detect table boundaries to avoid splitting them
    const tableBoundaries = this.detectTableBoundaries(cleanedContent)

    // Use the existing TextChunker
    const chunks = await this.textChunker.chunk(cleanedContent)

    // Post-process chunks to ensure tables aren't split
    const processedChunks = this.mergeTableChunks(
      chunks.map((chunk) => chunk.text),
      tableBoundaries,
      cleanedContent
    )

    // Ensure no chunk exceeds 300 tokens
    const finalChunks = this.enforceSizeLimit(processedChunks)

    return finalChunks
  }

  /**
   * Clean content by removing MDX-specific elements and excessive whitespace
   */
  private cleanContent(content: string): string {
    return (
      content
        // Remove import statements
        .replace(/^import\s+.*$/gm, '')
        // Remove JSX components and React-style comments
        .replace(/<[^>]+>/g, ' ')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
        // Remove excessive whitespace
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim()
    )
  }

  /**
   * Parse frontmatter from MDX content
   */
  private parseFrontmatter(content: string): { data: Frontmatter; content: string } {
    const frontmatterRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/
    const match = content.match(frontmatterRegex)

    if (!match) {
      return { data: {}, content }
    }

    const [, frontmatterText, markdownContent] = match
    const data: Frontmatter = {}

    // Simple YAML parsing for title and description
    const lines = frontmatterText.split('\n')
    for (const line of lines) {
      const colonIndex = line.indexOf(':')
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim()
        const value = line
          .slice(colonIndex + 1)
          .trim()
          .replace(/^['"]|['"]$/g, '')
        data[key] = value
      }
    }

    return { data, content: markdownContent }
  }

  /**
   * Estimate token count (rough approximation)
   */
  private estimateTokens(text: string): number {
    // Rough approximation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4)
  }

  /**
   * Detect table boundaries in markdown content to avoid splitting them
   */
  private detectTableBoundaries(content: string): { start: number; end: number }[] {
    const tables: { start: number; end: number }[] = []
    const lines = content.split('\n')

    let inTable = false
    let tableStart = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      // Detect table start (markdown table row with pipes)
      if (line.includes('|') && line.split('|').length >= 3 && !inTable) {
        // Check if next line is table separator (contains dashes and pipes)
        const nextLine = lines[i + 1]?.trim()
        if (nextLine?.includes('|') && nextLine.includes('-')) {
          inTable = true
          tableStart = i
        }
      }
      // Detect table end (empty line or non-table content)
      else if (inTable && (!line.includes('|') || line === '' || line.startsWith('#'))) {
        tables.push({
          start: this.getCharacterPosition(lines, tableStart),
          end: this.getCharacterPosition(lines, i - 1) + lines[i - 1]?.length || 0,
        })
        inTable = false
      }
    }

    // Handle table at end of content
    if (inTable && tableStart >= 0) {
      tables.push({
        start: this.getCharacterPosition(lines, tableStart),
        end: content.length,
      })
    }

    return tables
  }

  /**
   * Get character position from line number
   */
  private getCharacterPosition(lines: string[], lineIndex: number): number {
    return lines.slice(0, lineIndex).reduce((acc, line) => acc + line.length + 1, 0)
  }

  /**
   * Merge chunks that would split tables
   */
  private mergeTableChunks(
    chunks: string[],
    tableBoundaries: { start: number; end: number }[],
    originalContent: string
  ): string[] {
    if (tableBoundaries.length === 0) {
      return chunks
    }

    const mergedChunks: string[] = []
    let currentPosition = 0

    for (const chunk of chunks) {
      const chunkStart = originalContent.indexOf(chunk, currentPosition)
      const chunkEnd = chunkStart + chunk.length

      // Check if this chunk intersects with any table
      const intersectsTable = tableBoundaries.some(
        (table) =>
          (chunkStart >= table.start && chunkStart <= table.end) ||
          (chunkEnd >= table.start && chunkEnd <= table.end) ||
          (chunkStart <= table.start && chunkEnd >= table.end)
      )

      if (intersectsTable) {
        // Find which table(s) this chunk intersects with
        const affectedTables = tableBoundaries.filter(
          (table) =>
            (chunkStart >= table.start && chunkStart <= table.end) ||
            (chunkEnd >= table.start && chunkEnd <= table.end) ||
            (chunkStart <= table.start && chunkEnd >= table.end)
        )

        // Create a chunk that includes the complete table(s)
        const minStart = Math.min(chunkStart, ...affectedTables.map((t) => t.start))
        const maxEnd = Math.max(chunkEnd, ...affectedTables.map((t) => t.end))
        const completeChunk = originalContent.slice(minStart, maxEnd)

        // Only add if we haven't already included this content
        if (!mergedChunks.some((existing) => existing.includes(completeChunk.trim()))) {
          mergedChunks.push(completeChunk.trim())
        }
      } else {
        mergedChunks.push(chunk)
      }

      currentPosition = chunkEnd
    }

    return mergedChunks.filter((chunk) => chunk.length > 50) // Filter out tiny chunks
  }

  /**
   * Enforce 300 token size limit on chunks
   */
  private enforceSizeLimit(chunks: string[]): string[] {
    const finalChunks: string[] = []

    for (const chunk of chunks) {
      const tokens = this.estimateTokens(chunk)

      if (tokens <= 300) {
        // Chunk is within limit
        finalChunks.push(chunk)
      } else {
        // Chunk is too large - split it
        const lines = chunk.split('\n')
        let currentChunk = ''

        for (const line of lines) {
          const testChunk = currentChunk ? `${currentChunk}\n${line}` : line

          if (this.estimateTokens(testChunk) <= 300) {
            currentChunk = testChunk
          } else {
            // Adding this line would exceed limit
            if (currentChunk.trim()) {
              finalChunks.push(currentChunk.trim())
            }
            currentChunk = line
          }
        }

        // Add final chunk if it has content
        if (currentChunk.trim()) {
          finalChunks.push(currentChunk.trim())
        }
      }
    }

    return finalChunks.filter((chunk) => chunk.trim().length > 100)
  }
}
