import { existsSync } from 'fs'
import * as XLSX from 'xlsx'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('XlsxParser')

export class XlsxParser implements FileParser {
  async parseFile(filePath: string): Promise<FileParseResult> {
    try {
      // Validate input
      if (!filePath) {
        throw new Error('No file path provided')
      }

      // Check if file exists
      if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      logger.info(`Parsing XLSX file: ${filePath}`)

      // Read the workbook
      const workbook = XLSX.readFile(filePath)
      return this.processWorkbook(workbook)
    } catch (error) {
      logger.error('XLSX file parsing error:', error)
      throw new Error(`Failed to parse XLSX file: ${(error as Error).message}`)
    }
  }

  async parseBuffer(buffer: Buffer): Promise<FileParseResult> {
    try {
      logger.info('Parsing XLSX buffer, size:', buffer.length)

      if (!buffer || buffer.length === 0) {
        throw new Error('Empty buffer provided')
      }

      // Read the workbook from buffer
      const workbook = XLSX.read(buffer, { type: 'buffer' })
      return this.processWorkbook(workbook)
    } catch (error) {
      logger.error('XLSX buffer parsing error:', error)
      throw new Error(`Failed to parse XLSX buffer: ${(error as Error).message}`)
    }
  }

  private processWorkbook(workbook: XLSX.WorkBook): FileParseResult {
    const sheetNames = workbook.SheetNames
    const sheets: Record<string, any[]> = {}
    let content = ''
    let totalRows = 0

    // Process each worksheet
    for (const sheetName of sheetNames) {
      const worksheet = workbook.Sheets[sheetName]

      // Convert to array of objects
      const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1 })
      sheets[sheetName] = sheetData
      totalRows += sheetData.length

      // Add sheet content to the overall content string
      content += `Sheet: ${sheetName}\n`
      content += `=${'='.repeat(sheetName.length + 6)}\n\n`

      if (sheetData.length > 0) {
        // Process each row
        sheetData.forEach((row: unknown, rowIndex: number) => {
          if (Array.isArray(row) && row.length > 0) {
            // Convert row to string, handling undefined/null values
            const rowString = row
              .map((cell) => {
                if (cell === null || cell === undefined) {
                  return ''
                }
                return String(cell)
              })
              .join('\t')

            content += `${rowString}\n`
          }
        })
      } else {
        content += '[Empty sheet]\n'
      }

      content += '\n'
    }

    logger.info(`XLSX parsing completed: ${sheetNames.length} sheets, ${totalRows} total rows`)

    return {
      content: content.trim(),
      metadata: {
        sheetCount: sheetNames.length,
        sheetNames: sheetNames,
        totalRows: totalRows,
        sheets: sheets,
      },
    }
  }
}
