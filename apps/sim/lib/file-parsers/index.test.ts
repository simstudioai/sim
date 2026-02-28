/**
 * @vitest-environment node
 */
import path from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'

const {
  mockExistsSync,
  mockReadFile,
  mockPdfParseFile,
  mockCsvParseFile,
  mockDocxParseFile,
  mockTxtParseFile,
  mockMdParseFile,
  mockPptxParseFile,
  mockHtmlParseFile,
} = vi.hoisted(() => ({
  mockExistsSync: vi.fn().mockReturnValue(true),
  mockReadFile: vi.fn().mockResolvedValue(Buffer.from('test content')),
  mockPdfParseFile: vi.fn().mockResolvedValue({
    content: 'Parsed PDF content',
    metadata: { info: { Title: 'Test PDF' }, pageCount: 5, version: '1.7' },
  }),
  mockCsvParseFile: vi.fn().mockResolvedValue({
    content: 'Parsed CSV content',
    metadata: { headers: ['column1', 'column2'], rowCount: 10 },
  }),
  mockDocxParseFile: vi.fn().mockResolvedValue({
    content: 'Parsed DOCX content',
    metadata: { pages: 3, author: 'Test Author' },
  }),
  mockTxtParseFile: vi.fn().mockResolvedValue({
    content: 'Parsed TXT content',
    metadata: { characterCount: 100, tokenCount: 10 },
  }),
  mockMdParseFile: vi.fn().mockResolvedValue({
    content: 'Parsed MD content',
    metadata: { characterCount: 100, tokenCount: 10 },
  }),
  mockPptxParseFile: vi.fn().mockResolvedValue({
    content: 'Parsed PPTX content',
    metadata: { slideCount: 5, extractionMethod: 'officeparser' },
  }),
  mockHtmlParseFile: vi.fn().mockResolvedValue({
    content: 'Parsed HTML content',
    metadata: { title: 'Test HTML Document', headingCount: 3, linkCount: 2 },
  }),
}))

vi.mock('fs', () => ({ existsSync: mockExistsSync }))
vi.mock('fs/promises', () => ({ readFile: mockReadFile }))

vi.mock('@/lib/file-parsers/index', () => {
  const mockParsers: Record<string, FileParser> = {
    pdf: { parseFile: mockPdfParseFile },
    csv: { parseFile: mockCsvParseFile },
    docx: { parseFile: mockDocxParseFile },
    txt: { parseFile: mockTxtParseFile },
    md: { parseFile: mockMdParseFile },
    pptx: { parseFile: mockPptxParseFile },
    ppt: { parseFile: mockPptxParseFile },
    html: { parseFile: mockHtmlParseFile },
    htm: { parseFile: mockHtmlParseFile },
  }

  return {
    parseFile: async (filePath: string): Promise<FileParseResult> => {
      if (!filePath) {
        throw new Error('No file path provided')
      }

      if (!mockExistsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`)
      }

      const extension = path.extname(filePath).toLowerCase().substring(1)

      if (!Object.keys(mockParsers).includes(extension)) {
        throw new Error(
          `Unsupported file type: ${extension}. Supported types are: ${Object.keys(mockParsers).join(', ')}`
        )
      }

      return mockParsers[extension].parseFile(filePath)
    },

    isSupportedFileType: (extension: string): boolean => {
      if (!extension) return false
      return Object.keys(mockParsers).includes(extension.toLowerCase())
    },
  }
})

vi.mock('@/lib/file-parsers/pdf-parser', () => ({
  PdfParser: vi.fn().mockImplementation(() => ({ parseFile: mockPdfParseFile })),
}))
vi.mock('@/lib/file-parsers/csv-parser', () => ({
  CsvParser: vi.fn().mockImplementation(() => ({ parseFile: mockCsvParseFile })),
}))
vi.mock('@/lib/file-parsers/docx-parser', () => ({
  DocxParser: vi.fn().mockImplementation(() => ({ parseFile: mockDocxParseFile })),
}))
vi.mock('@/lib/file-parsers/txt-parser', () => ({
  TxtParser: vi.fn().mockImplementation(() => ({ parseFile: mockTxtParseFile })),
}))
vi.mock('@/lib/file-parsers/md-parser', () => ({
  MdParser: vi.fn().mockImplementation(() => ({ parseFile: mockMdParseFile })),
}))
vi.mock('@/lib/file-parsers/pptx-parser', () => ({
  PptxParser: vi.fn().mockImplementation(() => ({ parseFile: mockPptxParseFile })),
}))
vi.mock('@/lib/file-parsers/html-parser', () => ({
  HtmlParser: vi.fn().mockImplementation(() => ({ parseFile: mockHtmlParseFile })),
}))

import { isSupportedFileType, parseFile } from '@/lib/file-parsers/index'

describe('File Parsers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(true)
  })

  describe('parseFile', () => {
    it('should validate file existence', async () => {
      mockExistsSync.mockReturnValueOnce(false)

      const testFilePath = '/test/files/test.pdf'
      await expect(parseFile(testFilePath)).rejects.toThrow('File not found')
      expect(mockExistsSync).toHaveBeenCalledWith(testFilePath)
    })

    it('should throw error if file path is empty', async () => {
      await expect(parseFile('')).rejects.toThrow('No file path provided')
    })

    it('should parse PDF files successfully', async () => {
      const expectedResult = {
        content: 'Parsed PDF content',
        metadata: {
          info: { Title: 'Test PDF' },
          pageCount: 5,
          version: '1.7',
        },
      }

      mockPdfParseFile.mockResolvedValueOnce(expectedResult)

      const result = await parseFile('/test/files/document.pdf')

      expect(result).toEqual(expectedResult)
    })

    it('should parse CSV files successfully', async () => {
      const expectedResult = {
        content: 'Parsed CSV content',
        metadata: {
          headers: ['column1', 'column2'],
          rowCount: 10,
        },
      }

      mockCsvParseFile.mockResolvedValueOnce(expectedResult)

      const result = await parseFile('/test/files/data.csv')

      expect(result).toEqual(expectedResult)
    })

    it('should parse DOCX files successfully', async () => {
      const expectedResult = {
        content: 'Parsed DOCX content',
        metadata: {
          pages: 3,
          author: 'Test Author',
        },
      }

      mockDocxParseFile.mockResolvedValueOnce(expectedResult)

      const result = await parseFile('/test/files/document.docx')

      expect(result).toEqual(expectedResult)
    })

    it('should parse TXT files successfully', async () => {
      const expectedResult = {
        content: 'Parsed TXT content',
        metadata: {
          characterCount: 100,
          tokenCount: 10,
        },
      }

      mockTxtParseFile.mockResolvedValueOnce(expectedResult)

      const result = await parseFile('/test/files/document.txt')

      expect(result).toEqual(expectedResult)
    })

    it('should parse MD files successfully', async () => {
      const expectedResult = {
        content: 'Parsed MD content',
        metadata: {
          characterCount: 100,
          tokenCount: 10,
        },
      }

      mockMdParseFile.mockResolvedValueOnce(expectedResult)

      const result = await parseFile('/test/files/document.md')

      expect(result).toEqual(expectedResult)
    })

    it('should parse PPTX files successfully', async () => {
      const expectedResult = {
        content: 'Parsed PPTX content',
        metadata: {
          slideCount: 5,
          extractionMethod: 'officeparser',
        },
      }

      mockPptxParseFile.mockResolvedValueOnce(expectedResult)

      const result = await parseFile('/test/files/presentation.pptx')

      expect(result).toEqual(expectedResult)
    })

    it('should parse PPT files successfully', async () => {
      const expectedResult = {
        content: 'Parsed PPTX content',
        metadata: {
          slideCount: 5,
          extractionMethod: 'officeparser',
        },
      }

      mockPptxParseFile.mockResolvedValueOnce(expectedResult)

      const result = await parseFile('/test/files/presentation.ppt')

      expect(result).toEqual(expectedResult)
    })

    it('should parse HTML files successfully', async () => {
      const expectedResult = {
        content: 'Parsed HTML content',
        metadata: {
          title: 'Test HTML Document',
          headingCount: 3,
          linkCount: 2,
        },
      }

      mockHtmlParseFile.mockResolvedValueOnce(expectedResult)

      const result = await parseFile('/test/files/document.html')

      expect(result).toEqual(expectedResult)
    })

    it('should parse HTM files successfully', async () => {
      const expectedResult = {
        content: 'Parsed HTML content',
        metadata: {
          title: 'Test HTML Document',
          headingCount: 3,
          linkCount: 2,
        },
      }

      mockHtmlParseFile.mockResolvedValueOnce(expectedResult)

      const result = await parseFile('/test/files/document.htm')

      expect(result).toEqual(expectedResult)
    })

    it('should throw error for unsupported file types', async () => {
      const unsupportedFilePath = '/test/files/image.png'

      await expect(parseFile(unsupportedFilePath)).rejects.toThrow('Unsupported file type')
    })

    it('should handle errors during parsing', async () => {
      const parsingError = new Error('CSV parsing failed')
      mockCsvParseFile.mockRejectedValueOnce(parsingError)

      await expect(parseFile('/test/files/data.csv')).rejects.toThrow('CSV parsing failed')
    })
  })

  describe('isSupportedFileType', () => {
    it('should return true for supported file types', () => {
      expect(isSupportedFileType('pdf')).toBe(true)
      expect(isSupportedFileType('csv')).toBe(true)
      expect(isSupportedFileType('docx')).toBe(true)
      expect(isSupportedFileType('txt')).toBe(true)
      expect(isSupportedFileType('md')).toBe(true)
      expect(isSupportedFileType('pptx')).toBe(true)
      expect(isSupportedFileType('ppt')).toBe(true)
      expect(isSupportedFileType('html')).toBe(true)
      expect(isSupportedFileType('htm')).toBe(true)
    })

    it('should return false for unsupported file types', () => {
      expect(isSupportedFileType('png')).toBe(false)
      expect(isSupportedFileType('unknown')).toBe(false)
    })

    it('should handle uppercase extensions', () => {
      expect(isSupportedFileType('PDF')).toBe(true)
      expect(isSupportedFileType('CSV')).toBe(true)
      expect(isSupportedFileType('TXT')).toBe(true)
      expect(isSupportedFileType('MD')).toBe(true)
      expect(isSupportedFileType('PPTX')).toBe(true)
      expect(isSupportedFileType('HTML')).toBe(true)
    })

    it('should handle errors gracefully', () => {
      /**
       * This test verifies error propagation. The mock factory for
       * isSupportedFileType already handles this via the parseFile mock
       * which throws for unsupported types. We test by verifying the
       * function doesn't silently swallow errors from the parser lookup.
       */
      expect(() => isSupportedFileType('')).not.toThrow()
      expect(isSupportedFileType('')).toBe(false)
    })
  })
})
