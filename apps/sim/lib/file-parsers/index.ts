import { existsSync } from 'fs'
import path from 'path'
import type { FileParseResult, FileParser, SupportedFileType } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('FileParser')

let parserInstances: Record<string, FileParser> | null = null

/**
 * Get parser instances with lazy initialization
 */
function getParserInstances(): Record<string, FileParser> {
  if (parserInstances === null) {
    parserInstances = {}

    try {
      try {
        logger.info('Loading PDF parser...')
        const { PdfParser } = require('@/lib/file-parsers/pdf-parser')
        parserInstances.pdf = new PdfParser()
        logger.info('PDF parser loaded successfully')
      } catch (error) {
        logger.error('Failed to load PDF parser:', error)
      }

      try {
        const { CsvParser } = require('@/lib/file-parsers/csv-parser')
        parserInstances.csv = new CsvParser()
      } catch (error) {
        logger.error('Failed to load CSV parser:', error)
      }

      try {
        const { DocxParser } = require('@/lib/file-parsers/docx-parser')
        parserInstances.docx = new DocxParser()
      } catch (error) {
        logger.error('Failed to load DOCX parser:', error)
      }

      try {
        const { DocParser } = require('@/lib/file-parsers/doc-parser')
        parserInstances.doc = new DocParser()
      } catch (error) {
        logger.error('Failed to load DOC parser:', error)
      }

      try {
        const { TxtParser } = require('@/lib/file-parsers/txt-parser')
        parserInstances.txt = new TxtParser()
      } catch (error) {
        logger.error('Failed to load TXT parser:', error)
      }

      try {
        const { MdParser } = require('@/lib/file-parsers/md-parser')
        parserInstances.md = new MdParser()
      } catch (error) {
        logger.error('Failed to load MD parser:', error)
      }

      try {
        const { XlsxParser } = require('@/lib/file-parsers/xlsx-parser')
        parserInstances.xlsx = new XlsxParser()
        parserInstances.xls = new XlsxParser()
      } catch (error) {
        logger.error('Failed to load XLSX parser:', error)
      }

      try {
        const { PptxParser } = require('@/lib/file-parsers/pptx-parser')
        parserInstances.pptx = new PptxParser()
        parserInstances.ppt = new PptxParser()
      } catch (error) {
        logger.error('Failed to load PPTX parser:', error)
      }

      try {
        const { HtmlParser } = require('@/lib/file-parsers/html-parser')
        parserInstances.html = new HtmlParser()
        parserInstances.htm = new HtmlParser()
      } catch (error) {
        logger.error('Failed to load HTML parser:', error)
      }
    } catch (error) {
      logger.error('Error loading file parsers:', error)
    }
  }

  return parserInstances
}

/**
 * Parse a file based on its extension
 * @param filePath Path to the file
 * @returns Parsed content and metadata
 */
export async function parseFile(filePath: string): Promise<FileParseResult> {
  try {
    if (!filePath) {
      throw new Error('No file path provided')
    }

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

export type { FileParseResult, FileParser, SupportedFileType }
