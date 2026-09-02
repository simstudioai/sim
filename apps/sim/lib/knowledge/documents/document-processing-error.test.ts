import { describe, expect, it } from 'vitest'
import { FileParserError, type FileParserErrorCode } from '@/lib/file-parsers/errors'
import { ArchiveIntegrityError, ZipBombError } from '@/lib/file-parsers/ooxml-limits'
import {
  assertDocumentChunkCountWithinLimit,
  classifyDocumentProcessingFailure,
  MAX_DOCUMENT_CHUNKS,
  PermanentDocumentProcessingError,
  toPermanentDocumentProcessingError,
} from '@/lib/knowledge/documents/document-processing-error'

describe('document processing failure taxonomy', () => {
  it('classifies archive safety rejections without exposing technical limits as the remedy', () => {
    const failure = classifyDocumentProcessingFailure(
      new ZipBombError('Archive entry xl/worksheets/sheet1.xml exceeds 67108864 bytes'),
      'Vendor Spend.xlsx'
    )

    expect(failure).toEqual({
      disposition: 'permanent',
      code: 'archive_safety_limit',
      userMessage:
        'This file expands beyond the safe processing limit and was not indexed. Reduce its size or split it into smaller files, then retry.',
    })
  })

  it('does not infer archive safety from untyped exception text', () => {
    const failure = classifyDocumentProcessingFailure(
      new Error(
        'Failed to parse XLSX buffer: Archive total uncompressed size exceeds 157286400 bytes'
      ),
      'Marketing plan.xlsx'
    )

    expect(failure).toMatchObject({
      disposition: 'transient',
      code: 'transient_processing_failure',
    })
  })

  it('does not infer encryption from untyped exception text', () => {
    const failure = classifyDocumentProcessingFailure(
      new Error('Failed to parse XLSX buffer: File is password-protected'),
      'Reconciliation.xlsx'
    )

    expect(failure).toMatchObject({
      disposition: 'transient',
      code: 'transient_processing_failure',
    })
  })

  it('does not dead-letter Office files from untyped exception text', () => {
    const failure = classifyDocumentProcessingFailure(
      new Error('Failed to parse DOCX buffer: Failed to extract text from DOCX file'),
      'Letterhead.dotx'
    )

    expect(failure).toMatchObject({
      disposition: 'transient',
      code: 'transient_processing_failure',
    })
  })

  it('preserves typed no-text guidance', () => {
    const error = new PermanentDocumentProcessingError(
      'no_extractable_text',
      'No text could be extracted. Re-save it as DOCX to index it.'
    )

    expect(classifyDocumentProcessingFailure(error, 'Contract.doc')).toEqual({
      disposition: 'permanent',
      code: 'no_extractable_text',
      userMessage: error.message,
    })
    expect(toPermanentDocumentProcessingError(error, 'Contract.doc')).toBe(error)
  })

  it.each(['Contract.doc', 'Budget.xls', 'Deck.ppt'])(
    'classifies an unreadable legacy Office file as repairable: %s',
    (filename) => {
      const failure = classifyDocumentProcessingFailure(
        new FileParserError('invalid_format', 'The legacy Office file could not be parsed'),
        filename
      )

      expect(failure).toMatchObject({
        disposition: 'permanent',
        code: 'unreadable_office_file',
        userMessage: expect.stringContaining('re-save'),
      })
    }
  )

  it.each<{
    parserCode: FileParserErrorCode
    filename: string
    disposition: 'permanent' | 'transient'
    documentCode: string
  }>([
    {
      parserCode: 'empty_input',
      filename: 'empty.pdf',
      disposition: 'permanent',
      documentCode: 'invalid_file',
    },
    {
      parserCode: 'unsupported_type',
      filename: 'diagram.vsdx',
      disposition: 'permanent',
      documentCode: 'unsupported_file_type',
    },
    {
      parserCode: 'encrypted_file',
      filename: 'protected.xlsx',
      disposition: 'permanent',
      documentCode: 'encrypted_file',
    },
    {
      parserCode: 'no_extractable_text',
      filename: 'scan.pdf',
      disposition: 'permanent',
      documentCode: 'no_extractable_text',
    },
    {
      parserCode: 'invalid_format',
      filename: 'damaged.dotx',
      disposition: 'permanent',
      documentCode: 'unreadable_office_file',
    },
    {
      parserCode: 'runtime_failure',
      filename: 'valid.docx',
      disposition: 'transient',
      documentCode: 'transient_processing_failure',
    },
    {
      parserCode: 'complexity_limit',
      filename: 'large.yaml',
      disposition: 'permanent',
      documentCode: 'document_complexity_limit',
    },
  ])(
    'maps typed parser code $parserCode exhaustively into the document taxonomy',
    ({ parserCode, filename, disposition, documentCode }) => {
      const failure = classifyDocumentProcessingFailure(
        new FileParserError(parserCode, `parser failure: ${parserCode}`),
        filename
      )

      expect(failure).toMatchObject({ disposition, code: documentCode })
    }
  )

  it('keeps a successful-but-empty OCR result permanent and an OCR timeout transient', () => {
    const empty = new PermanentDocumentProcessingError(
      'no_extractable_text',
      'No text could be extracted from this file.'
    )

    expect(classifyDocumentProcessingFailure(empty, 'scan.pdf')).toMatchObject({
      disposition: 'permanent',
      code: 'no_extractable_text',
    })
    expect(
      classifyDocumentProcessingFailure(new Error('OCR API request timed out'), 'scan.pdf')
    ).toMatchObject({
      disposition: 'transient',
      code: 'transient_processing_failure',
    })
  })

  it('keeps stale downloads and access failures transient', () => {
    for (const error of [
      Object.assign(new Error('Not Found'), { status: 404 }),
      Object.assign(new Error('Access denied'), { status: 403 }),
    ]) {
      expect(classifyDocumentProcessingFailure(error, 'Report.docx')).toMatchObject({
        disposition: 'transient',
        code: 'transient_processing_failure',
      })
    }
  })

  it('leaves infrastructure and provider failures transient', () => {
    for (const error of [
      new Error('Storage request timed out'),
      new Error('Database connection terminated unexpectedly'),
      new Error('Embedding provider returned 503'),
      new TypeError('parseOffice is not a function'),
    ]) {
      expect(classifyDocumentProcessingFailure(error, 'Report.docx')).toMatchObject({
        disposition: 'transient',
        code: 'transient_processing_failure',
      })
      expect(toPermanentDocumentProcessingError(error, 'Report.docx')).toBeNull()
    }
  })

  it('rejects excessive chunk counts before embedding allocation without truncating content', () => {
    expect(() => assertDocumentChunkCountWithinLimit(MAX_DOCUMENT_CHUNKS)).not.toThrow()
    expect(() => assertDocumentChunkCountWithinLimit(MAX_DOCUMENT_CHUNKS + 1)).toThrowError(
      expect.objectContaining({
        code: 'document_complexity_limit',
        message: expect.stringContaining('Split it into smaller files'),
      })
    )
  })

  it('distinguishes malformed archive integrity from an expanded-size limit', () => {
    const failure = classifyDocumentProcessingFailure(
      new ArchiveIntegrityError('Unable to inspect ZIP central directory'),
      'damaged.docx'
    )

    expect(failure).toMatchObject({
      disposition: 'permanent',
      code: 'unreadable_office_file',
      userMessage: expect.stringContaining('re-save'),
    })
  })
})
