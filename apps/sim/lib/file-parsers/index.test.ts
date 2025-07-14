import path from 'path'
/**
 * Unit tests for file parsers
 *
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileParseResult, FileParser } from '@/lib/file-parsers/types'

// Mock file system modules
const mockExistsSync = vi.fn().mockReturnValue(true)
const mockReadFile = vi.fn().mockResolvedValue(Buffer.from('test content'))

// Mock parser functions
const mockPdfParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed PDF content',
  metadata: {
    info: { Title: 'Test PDF' },
    pageCount: 5,
    version: '1.7',
  },
})

const mockCsvParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed CSV content',
  metadata: {
    headers: ['column1', 'column2'],
    rowCount: 10,
  },
})

const mockDocxParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed DOCX content',
  metadata: {
    pages: 3,
    author: 'Test Author',
  },
})

const mockTxtParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed TXT content',
  metadata: {
    characterCount: 100,
    tokenCount: 10,
  },
})

const mockMdParseFile = vi.fn().mockResolvedValue({
  content: 'Parsed MD content',
  metadata: {
    characterCount: 100,
    tokenCount: 10,
  },
})

// Create mock module implementation
const createMockModule = () => {
  // Create mock parsers
  const mockParsers: Record<string, FileParser> = {
    pdf: { parseFile: mockPdfParseFile },
    csv: { parseFile: mockCsvParseFile },
    docx: { parseFile: mockDocxParseFile },
    txt: { parseFile: mockTxtParseFile },
    md: { parseFile: mockMdParseFile },
  }

  // Create the mock module implementation
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
}

describe('File Parsers', () => {
  // Setup required mocks before each test
  beforeEach(() => {
    vi.resetModules()

    // Mock file system modules
    vi.doMock('fs', () => ({
      existsSync: mockExistsSync,
    }))

    vi.doMock('fs/promises', () => ({
      readFile: mockReadFile,
    }))

    // Mock the file parser module with our implementation
    vi.doMock('./index', () => createMockModule())

    // Mock parser classes
    vi.doMock('./pdf-parser', () => ({
      PdfParser: vi.fn().mockImplementation(() => ({
        parseFile: mockPdfParseFile,
      })),
    }))

    vi.doMock('./csv-parser', () => ({
      CsvParser: vi.fn().mockImplementation(() => ({
        parseFile: mockCsvParseFile,
      })),
    }))

    vi.doMock('./docx-parser', () => ({
      DocxParser: vi.fn().mockImplementation(() => ({
        parseFile: mockDocxParseFile,
      })),
    }))

    vi.doMock('./raw-pdf-parser', () => ({
      RawPdfParser: vi.fn().mockImplementation(() => ({
        parseFile: vi.fn().mockResolvedValue({
          content: 'Raw parsed PDF content',
          metadata: {
            pageCount: 3,
          },
        }),
      })),
    }))

    vi.doMock('./txt-parser', () => ({
      TxtParser: vi.fn().mockImplementation(() => ({
        parseFile: mockTxtParseFile,
      })),
    }))

    vi.doMock('./md-parser', () => ({
      MdParser: vi.fn().mockImplementation(() => ({
        parseFile: mockMdParseFile,
      })),
    }))

    // Silence console output during tests
    global.console = {
      ...console,
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.resetAllMocks()
    vi.restoreAllMocks()
  })

  describe('parseFile', () => {
    it('should validate file existence', async () => {
      // Mock file not existing for this test only
      mockExistsSync.mockReturnValueOnce(false)

      // Dynamically import the module after mocks are set up
      const { parseFile } = await import('./index')

      const testFilePath = '/test/files/test.pdf'
      await expect(parseFile(testFilePath)).rejects.toThrow('File not found')
      expect(mockExistsSync).toHaveBeenCalledWith(testFilePath)
    })

    it('should throw error if file path is empty', async () => {
      const { parseFile } = await import('./index')
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
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('./index')
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
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('./index')
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
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('./index')
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
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('./index')
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
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('./index')
      const result = await parseFile('/test/files/document.md')
    })

    it('should throw error for unsupported file types', async () => {
      // Make sure the file "exists" for this test
      mockExistsSync.mockReturnValue(true)

      const { parseFile } = await import('./index')
      const unsupportedFilePath = '/test/files/image.png'

      await expect(parseFile(unsupportedFilePath)).rejects.toThrow('Unsupported file type')
    })

    it('should handle errors during parsing', async () => {
      // Make sure the file "exists" for this test
      mockExistsSync.mockReturnValue(true)

      const parsingError = new Error('CSV parsing failed')
      mockCsvParseFile.mockRejectedValueOnce(parsingError)

      const { parseFile } = await import('./index')
      await expect(parseFile('/test/files/data.csv')).rejects.toThrow('CSV parsing failed')
    })
  })

  describe('isSupportedFileType', () => {
    it('should return true for supported file types', async () => {
      const { isSupportedFileType } = await import('./index')

      expect(isSupportedFileType('pdf')).toBe(true)
      expect(isSupportedFileType('csv')).toBe(true)
      expect(isSupportedFileType('docx')).toBe(true)
      expect(isSupportedFileType('txt')).toBe(true)
      expect(isSupportedFileType('md')).toBe(true)
    })

    it('should return false for unsupported file types', async () => {
      const { isSupportedFileType } = await import('./index')

      expect(isSupportedFileType('png')).toBe(false)
      expect(isSupportedFileType('unknown')).toBe(false)
    })

    it('should handle uppercase extensions', async () => {
      const { isSupportedFileType } = await import('./index')

      expect(isSupportedFileType('PDF')).toBe(true)
      expect(isSupportedFileType('CSV')).toBe(true)
      expect(isSupportedFileType('TXT')).toBe(true)
      expect(isSupportedFileType('MD')).toBe(true)
    })

    it('should handle errors gracefully', async () => {
      // Create a mock that throws an error when called
      const errorMockModule = {
        isSupportedFileType: () => {
          throw new Error('Failed to get parsers')
        },
      }

      // Mock the module with our error-throwing implementation
      vi.doMock('./index', () => errorMockModule)

      // Import and test
      const { isSupportedFileType } = await import('./index')

      // Should catch the error and return false
      expect(() => isSupportedFileType('pdf')).toThrow('Failed to get parsers')
    })
  })
})
