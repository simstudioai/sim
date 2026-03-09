import fs from 'fs/promises'
import path from 'path'
import { createLogger } from '@sim/logger'
import { TextChunker } from '@/lib/chunkers/text-chunker'
import type { DocChunk, DocsChunkerOptions } from '@/lib/chunkers/types'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'

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
  [key: string]: unknown
}

const logger = createLogger('DocsChunker')

/**
 * Docs-specific chunker that processes .mdx files and tracks header context
 */
export class DocsChunker {
  private readonly textChunker: TextChunker
  private readonly baseUrl: string

  constructor(options: DocsChunkerOptions = {}) {
    this.textChunker = new TextChunker({
      chunkSize: options.chunkSize ?? 300, // Max 300 tokens per chunk
      minCharactersPerChunk: options.minCharactersPerChunk ?? 1,
      chunkOverlap: options.chunkOverlap ?? 50,
    })
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

    const { data: frontmatter, content: markdownContent } = this.parseFrontmatter(content)

    const headers = this.extractHeaders(markdownContent)

    const documentUrl = this.generateDocumentUrl(relativePath)

    const textChunks = await this.splitContent(markdownContent)

    logger.info(`Generating embeddings for ${textChunks.length} chunks in ${relativePath}`)
    const embeddings = textChunks.length > 0 ? await generateEmbeddings(textChunks) : []
    const embeddingModel = 'text-embedding-3-small'

    const chunks: DocChunk[] = []
    let currentPosition = 0

    for (let i = 0; i < textChunks.length; i++) {
      const chunkText = textChunks[i]
      const chunkStart = currentPosition
      const chunkEnd = currentPosition + chunkText.length

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
   * Handles index.mdx files specially - they are served at the parent directory path
   */
  private generateDocumentUrl(relativePath: string): string {
    // Convert file path to URL path
    // e.g., "tools/knowledge.mdx" -> "/tools/knowledge"
    // e.g., "triggers/index.mdx" -> "/triggers" (NOT "/triggers/index")
    let urlPath = relativePath.replace(/\.mdx$/, '').replace(/\\/g, '/') // Handle Windows paths

    // In fumadocs, index.mdx files are served at the parent directory path
    // e.g., "triggers/index" -> "triggers"
    if (urlPath.endsWith('/index')) {
      urlPath = urlPath.slice(0, -6) // Remove "/index"
    } else if (urlPath === 'index') {
      urlPath = '' // Root index.mdx
    }

    return `${this.baseUrl}/${urlPath}`
  }

  /**
   * Find the most relevant header for a given position
   */
  private findRelevantHeader(headers: HeaderInfo[], position: number): HeaderInfo | null {
    if (headers.length === 0) return null

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
    const cleanedContent = this.cleanContent(content)

    const tableBoundaries = this.detectTableBoundaries(cleanedContent)

    const chunks = await this.textChunker.chunk(cleanedContent)

    const processedChunks = this.mergeTableChunks(
      chunks.map((chunk) => chunk.text),
      tableBoundaries,
      cleanedContent
    )

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

      if (line.includes('|') && line.split('|').length >= 3 && !inTable) {
        const nextLine = lines[i + 1]?.trim()
        if (nextLine?.includes('|') && nextLine.includes('-')) {
          inTable = true
          tableStart = i
        }
      } else if (inTable && (!line.includes('|') || line === '' || line.startsWith('#'))) {
        tables.push({
          start: this.getCharacterPosition(lines, tableStart),
          end: this.getCharacterPosition(lines, i - 1) + lines[i - 1]?.length || 0,
        })
        inTable = false
      }
    }

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

      const intersectsTable = tableBoundaries.some(
        (table) =>
          (chunkStart >= table.start && chunkStart <= table.end) ||
          (chunkEnd >= table.start && chunkEnd <= table.end) ||
          (chunkStart <= table.start && chunkEnd >= table.end)
      )

      if (intersectsTable) {
        const affectedTables = tableBoundaries.filter(
          (table) =>
            (chunkStart >= table.start && chunkStart <= table.end) ||
            (chunkEnd >= table.start && chunkEnd <= table.end) ||
            (chunkStart <= table.start && chunkEnd >= table.end)
        )

        const minStart = Math.min(chunkStart, ...affectedTables.map((t) => t.start))
        const maxEnd = Math.max(chunkEnd, ...affectedTables.map((t) => t.end))
        const completeChunk = originalContent.slice(minStart, maxEnd)

        if (!mergedChunks.some((existing) => existing.includes(completeChunk.trim()))) {
          mergedChunks.push(completeChunk.trim())
        }
      } else {
        mergedChunks.push(chunk)
      }

      currentPosition = chunkEnd
    }

    return mergedChunks.filter((chunk) => chunk.length > 50)
  }

  /**
   * Enforce 300 token size limit on chunks
   */
  private enforceSizeLimit(chunks: string[]): string[] {
    const finalChunks: string[] = []

    for (const chunk of chunks) {
      const tokens = this.estimateTokens(chunk)

      if (tokens <= 300) {
        finalChunks.push(chunk)
      } else {
        const lines = chunk.split('\n')
        let currentChunk = ''

        for (const line of lines) {
          const testChunk = currentChunk ? `${currentChunk}\n${line}` : line

          if (this.estimateTokens(testChunk) <= 300) {
            currentChunk = testChunk
          } else {
            if (currentChunk.trim()) {
              finalChunks.push(currentChunk.trim())
            }
            currentChunk = line
          }
        }

        if (currentChunk.trim()) {
          finalChunks.push(currentChunk.trim())
        }
      }
    }

    return finalChunks.filter((chunk) => chunk.trim().length > 100)
  }
}
