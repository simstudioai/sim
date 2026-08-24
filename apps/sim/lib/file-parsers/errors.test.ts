import { describe, expect, it } from 'vitest'
import {
  FileParserError,
  isEncryptedOfficeParserError,
  toFileParserError,
} from '@/lib/file-parsers/errors'
import { ZipBombError } from '@/lib/file-parsers/ooxml-limits'

describe('file parser errors', () => {
  it('preserves an archive safety rejection through parser wrappers', () => {
    const archiveError = new ZipBombError('Archive exceeds the expanded-size limit')

    expect(toFileParserError(archiveError, 'invalid_format', 'DOCX parse failed')).toBe(
      archiveError
    )
  })

  it('preserves an existing typed parser failure', () => {
    const parserError = new FileParserError('encrypted_file', 'Workbook is protected')

    expect(toFileParserError(parserError, 'invalid_format', 'XLSX parse failed')).toBe(parserError)
  })

  it('retains an untyped parser-library exception as the cause', () => {
    const libraryError = new Error('invalid central directory')
    const parserError = toFileParserError(libraryError, 'invalid_format', 'DOCX parse failed')

    expect(parserError).toBeInstanceOf(FileParserError)
    expect(parserError.cause).toBe(libraryError)
  })

  it.each([
    'File is password-protected',
    'Password is required to open this workbook',
    'Encrypted workbook is not supported',
  ])('recognizes the SheetJS encrypted-workbook error: %s', (message) => {
    expect(isEncryptedOfficeParserError(new Error(message))).toBe(true)
  })
})
