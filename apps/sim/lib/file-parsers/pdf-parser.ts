import { readFile } from 'fs/promises'
// @ts-ignore
import * as pdfParseLib from 'pdf-parse/lib/pdf-parse.js'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('PdfParser')

export class PdfParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      logger.info('Starting to parse file:', filePath)

      // Make sure we're only parsing the provided file path
      if (!filePath) {
        throw new Error('No file path provided')
      }

      // Read the file
      logger.info('Reading file...')
      const dataBuffer = await readFile(filePath)
      logger.info('File read successfully, size:', dataBuffer.length)

      return this.parseBuffer(dataBuffer)
    } catch (error) {
      logger.error('Error reading file:', error)
      throw error
    }
  }

  async parseBuffer(dataBuffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Starting to parse buffer, size:', dataBuffer.length)

      // Try to parse with pdf-parse library first
      try {
        logger.info('Attempting to parse with pdf-parse library...')

        // Parse PDF with direct function call to avoid test file access
        logger.info('Starting PDF parsing...')
        const data = await pdfParseLib.default(dataBuffer)
        logger.info('PDF parsed successfully with pdf-parse, pages:', data.numpages)

        return {
          content: data.text,
          metadata: {
            pageCount: data.numpages,
            info: data.info,
            version: data.version,
          },
        }
      } catch (pdfParseError: unknown) {
        logger.error('PDF-parse library failed:', pdfParseError)

        // Fallback to manual text extraction
        logger.info('Falling back to manual text extraction...')

        // Extract basic PDF info from raw content
        const rawContent = dataBuffer.toString('utf-8', 0, Math.min(10000, dataBuffer.length))

        let version = 'Unknown'
        let pageCount = 0

        // Try to extract PDF version
        const versionMatch = rawContent.match(/%PDF-(\d+\.\d+)/)
        if (versionMatch?.[1]) {
          version = versionMatch[1]
        }

        // Try to get page count
        const pageMatches = rawContent.match(/\/Type\s*\/Page\b/g)
        if (pageMatches) {
          pageCount = pageMatches.length
        }

        // Try to extract text by looking for text-related operators in the PDF
        let extractedText = ''

        // Look for text in the PDF content using common patterns
        const textMatches = rawContent.match(/BT[\s\S]*?ET/g)
        if (textMatches && textMatches.length > 0) {
          extractedText = textMatches
            .map((textBlock) => {
              // Extract text objects (Tj, TJ) from the text block
              const textObjects = textBlock.match(/\([^)]*\)\s*Tj|\[[^\]]*\]\s*TJ/g)
              if (textObjects) {
                return textObjects
                  .map((obj) => {
                    // Clean up text objects
                    return (
                      obj
                        .replace(
                          /\(([^)]*)\)\s*Tj|\[([^\]]*)\]\s*TJ/g,
                          (match, p1, p2) => p1 || p2 || ''
                        )
                        // Clean up PDF escape sequences
                        .replace(/\\(\d{3}|[()\\])/g, '')
                        .replace(/\\\\/g, '\\')
                        .replace(/\\\(/g, '(')
                        .replace(/\\\)/g, ')')
                    )
                  })
                  .join(' ')
              }
              return ''
            })
            .join('\n')
        }

        // If we couldn't extract text or the text is too short, return a fallback message
        if (!extractedText || extractedText.length < 50) {
          extractedText = `This PDF contains ${pageCount} page(s) but text extraction was not successful.`
        }

        return {
          content: extractedText,
          metadata: {
            pageCount,
            version,
            fallback: true,
            error: (pdfParseError as Error).message || 'Unknown error',
          },
        }
      }
    } catch (error) {
      logger.error('Error parsing buffer:', error)
      throw error
    }
  }
}
