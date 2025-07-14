import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { RawPdfParser } from '@/lib/file-parsers/raw-pdf-parser'
import type { FileParseResult, FileParser, SupportedFileType } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('FileParser')

// Lazy-loaded parsers to avoid initialization issues
let parserInstances: Record<string, FileParser> | null = null

/**
 * Get parser instances with lazy initialization
 */
function getParserInstances(): Record<string, FileParser> {
  if (parserInstances === null) {
    parserInstances = {}

    try {
      // Import parsers only when needed - with try/catch for each one
      try {
        logger.info('Attempting to load PDF parser...')
        try {
          // First try to use the pdf-parse library
          // Import the PdfParser using ES module import to avoid test file access
          const { PdfParser } = require('./pdf-parser')
          parserInstances.pdf = new PdfParser()
          logger.info('PDF parser loaded successfully')
        } catch (pdfParseError) {
          // If that fails, fallback to our raw PDF parser
          logger.error('Failed to load primary PDF parser:', pdfParseError)
          logger.info('Falling back to raw PDF parser')
          parserInstances.pdf = new RawPdfParser()
          logger.info('Raw PDF parser loaded successfully')
        }
      } catch (error) {
        logger.error('Failed to load any PDF parser:', error)
        // Create a simple fallback that just returns the file size and a message
        parserInstances.pdf = {
          async parseFile(filePath: string): Promise<FileParseResult> {
            const buffer = await readFile(filePath)
            return {
              content: `PDF parsing is not available. File size: ${buffer.length} bytes`,
              metadata: {
                info: { Error: 'PDF parsing unavailable' },
                pageCount: 0,
                version: 'unknown',
              },
            }
          },
          async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
            return {
              content: `PDF parsing is not available. File size: ${buffer.length} bytes`,
              metadata: {
                info: { Error: 'PDF parsing unavailable' },
                pageCount: 0,
                version: 'unknown',
              },
            }
          },
        }
      }

      try {
        const { CsvParser } = require('./csv-parser')
        parserInstances.csv = new CsvParser()
      } catch (error) {
        logger.error('Failed to load CSV parser:', error)
      }

      try {
        const { DocxParser } = require('./docx-parser')
        parserInstances.docx = new DocxParser()
      } catch (error) {
        logger.error('Failed to load DOCX parser:', error)
      }

      try {
        const { TxtParser } = require('./txt-parser')
        parserInstances.txt = new TxtParser()
      } catch (error) {
        logger.error('Failed to load TXT parser:', error)
      }

      try {
        const { MdParser } = require('./md-parser')
        parserInstances.md = new MdParser()
      } catch (error) {
        logger.error('Failed to load MD parser:', error)
      }

      try {
        const { XlsxParser } = require('./xlsx-parser')
        parserInstances.xlsx = new XlsxParser()
        parserInstances.xls = new XlsxParser() // Both xls and xlsx use the same parser
      } catch (error) {
        logger.error('Failed to load XLSX parser:', error)
      }
    } catch (error) {
      logger.error('Error loading file parsers:', error)
    }
  }

  logger.info('Available parsers:', Object.keys(parserInstances))
  return parserInstances
}

/**
 * Parse a file based on its extension
 * @param filePath Path to the file
 * @returns Parsed content and metadata
 */
export async function parseFile(filePath: string): Promise<FileParseResult> {
  try {
    // Validate input
    if (!filePath) {
      throw new Error('No file path provided')
    }

    // Check if file exists
    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    const extension = path.extname(filePath).toLowerCase().substring(1)
    logger.info('Attempting to parse file with extension:', extension)

    const parsers = getParserInstances()

    if (!Object.keys(parsers).includes(extension)) {
      logger.info('No parser found for extension:', extension)
      throw new Error(
        `Unsupported file type: ${extension}. Supported types are: ${Object.keys(parsers).join(', ')}`
      )
    }

    logger.info('Using parser for extension:', extension)
    const parser = parsers[extension]
    return await parser.parseFile(filePath)
  } catch (error) {
    logger.error('File parsing error:', error)
    throw error
  }
}

/**
 * Parse a buffer based on file extension
 * @param buffer Buffer containing the file data
 * @param extension File extension without the dot (e.g., 'pdf', 'csv')
 * @returns Parsed content and metadata
 */
export async function parseBuffer(buffer: Buffer, extension: string): Promise<FileParseResult> {
  try {
    // Validate input
    if (!buffer || buffer.length === 0) {
      throw new Error('Empty buffer provided')
    }

    if (!extension) {
      throw new Error('No file extension provided')
    }

    const normalizedExtension = extension.toLowerCase()
    logger.info('Attempting to parse buffer with extension:', normalizedExtension)

    const parsers = getParserInstances()

    if (!Object.keys(parsers).includes(normalizedExtension)) {
      logger.info('No parser found for extension:', normalizedExtension)
      throw new Error(
        `Unsupported file type: ${normalizedExtension}. Supported types are: ${Object.keys(parsers).join(', ')}`
      )
    }

    logger.info('Using parser for extension:', normalizedExtension)
    const parser = parsers[normalizedExtension]

    // Check if parser supports buffer parsing
    if (parser.parseBuffer) {
      return await parser.parseBuffer(buffer)
    }
    throw new Error(`Parser for ${normalizedExtension} does not support buffer parsing`)
  } catch (error) {
    logger.error('Buffer parsing error:', error)
    throw error
  }
}

/**
 * Check if a file type is supported
 * @param extension File extension without the dot
 * @returns true if supported, false otherwise
 */
export function isSupportedFileType(extension: string): extension is SupportedFileType {
  try {
    return Object.keys(getParserInstances()).includes(extension.toLowerCase())
  } catch (error) {
    logger.error('Error checking supported file type:', error)
    return false
  }
}

// Type exports
export type { FileParseResult, FileParser, SupportedFileType }
