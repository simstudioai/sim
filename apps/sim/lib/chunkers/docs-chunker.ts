import fs from 'fs/promises'
import path from 'path'
import { createLogger } from '@sim/logger'
import { TextChunker } from '@/lib/chunkers/text-chunker'
import type { DocChunk, DocsChunkerOptions } from '@/lib/chunkers/types'
import { estimateTokens } from '@/lib/chunkers/utils'
import { generateEmbeddings } from '@/lib/knowledge/embeddings'

interface HeaderInfo {
  level: number
  text: string
  anchor?: string
  position?: number
}

interface Frontmatter {
  title?: string
  description?: string
  [key: string]: unknown
}

const logger = createLogger('DocsChunker')

export class DocsChunker {
  private readonly textChunker: TextChunker
  private readonly baseUrl: string
  private readonly chunkSize: number

  constructor(options: DocsChunkerOptions = {}) {
    this.chunkSize = options.chunkSize ?? 300
    this.textChunker = new TextChunker({
      chunkSize: this.chunkSize,
      minCharactersPerChunk: options.minCharactersPerChunk ?? 1,
      chunkOverlap: options.chunkOverlap ?? 50,
    })
    this.baseUrl = options.baseUrl ?? 'https://docs.sim.ai'
  }

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

  async chunkMdxFile(filePath: string, basePath: string): Promise<DocChunk[]> {
    const content = await fs.readFile(filePath, 'utf-8')
    const relativePath = path.relative(basePath, filePath)

    const { data: frontmatter, content: markdownContent } = this.parseFrontmatter(content)

    const documentUrl = this.generateDocumentUrl(relativePath)

    const { chunks: textChunks, cleanedContent } = await this.splitContent(markdownContent)

    const headers = this.extractHeaders(cleanedContent)

    logger.info(`Generating embeddings for ${textChunks.length} chunks in ${relativePath}`)
    const embeddings: number[][] =
      textChunks.length > 0 ? (await generateEmbeddings(textChunks)).embeddings : []
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
        tokenCount: estimateTokens(chunkText),
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

  private generateAnchor(headerText: string): string {
    return headerText
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
  }

  /** index.mdx files are served at the parent directory path */
  private generateDocumentUrl(relativePath: string): string {
    let urlPath = relativePath.replace(/\.mdx$/, '').replace(/\\/g, '/')

    if (urlPath.endsWith('/index')) {
      urlPath = urlPath.slice(0, -6)
    } else if (urlPath === 'index') {
      urlPath = ''
    }

    return `${this.baseUrl}/${urlPath}`
  }

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

  /** Returns both chunks and cleaned content so header extraction uses aligned positions. */
  private async splitContent(
    content: string
  ): Promise<{ chunks: string[]; cleanedContent: string }> {
    const cleanedContent = this.cleanContent(content)

    const tableBoundaries = this.detectTableBoundaries(cleanedContent)

    const chunks = await this.textChunker.chunk(cleanedContent)

    const processedChunks = this.mergeTableChunks(
      chunks.map((chunk) => chunk.text),
      tableBoundaries,
      cleanedContent
    )

    const finalChunks = this.enforceSizeLimit(processedChunks)

    return { chunks: finalChunks, cleanedContent }
  }

  private cleanContent(content: string): string {
    return content
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/^import\s+.*$/gm, '')
      .replace(/^export\s+.*$/gm, '')
      .replace(/<\/?[a-zA-Z][^>]*>/g, ' ')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
      .replace(/\{[^{}]*\}/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
  }

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

  /** Detects table boundaries to avoid splitting tables across chunks. */
  private detectTableBoundaries(content: string): { start: number; end: number }[] {
    const tables: { start: number; end: number }[] = []
    const lines = content.split('\n')

    let inTable = false
    let inCodeBlock = false
    let tableStart = -1

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()

      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock
        continue
      }

      if (inCodeBlock) continue

      if (line.includes('|') && line.split('|').length >= 3 && !inTable) {
        const nextLine = lines[i + 1]?.trim()
        if (nextLine?.includes('|') && nextLine.includes('-')) {
          inTable = true
          tableStart = i
        }
      } else if (inTable && (!line.includes('|') || line === '' || line.startsWith('#'))) {
        tables.push({
          start: this.getCharacterPosition(lines, tableStart),
          end: this.getCharacterPosition(lines, i - 1) + (lines[i - 1]?.length ?? 0),
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

  private getCharacterPosition(lines: string[], lineIndex: number): number {
    return lines.slice(0, lineIndex).reduce((acc, line) => acc + line.length + 1, 0)
  }

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
      if (chunkStart === -1) {
        mergedChunks.push(chunk)
        continue
      }
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
        const completeChunk = originalContent.slice(minStart, maxEnd).trim()

        if (completeChunk && !mergedChunks.some((existing) => existing === completeChunk)) {
          mergedChunks.push(completeChunk)
        }
      } else {
        mergedChunks.push(chunk)
      }

      currentPosition = chunkEnd
    }

    return mergedChunks.filter((chunk) => chunk.length > 50)
  }

  private enforceSizeLimit(chunks: string[]): string[] {
    const finalChunks: string[] = []

    for (const chunk of chunks) {
      const tokens = estimateTokens(chunk)

      if (tokens <= this.chunkSize) {
        finalChunks.push(chunk)
      } else {
        const lines = chunk.split('\n')
        let currentChunk = ''

        for (const line of lines) {
          const testChunk = currentChunk ? `${currentChunk}\n${line}` : line

          if (estimateTokens(testChunk) <= this.chunkSize) {
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
