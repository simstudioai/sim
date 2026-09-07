/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  normalizeDocumentAnalysis,
  normalizeDocumentJob,
  normalizeDocumentModel,
} from '@/lib/internal/oci-document-understanding/normalizers'
import type { ProjectionInput } from '@/lib/internal/oci-document-understanding/schema'

const projection: ProjectionInput = {
  maxPages: 20,
  maxOutputBytes: 1024 * 1024,
  includeWords: false,
  includeGeometry: false,
}
const polygon = { normalizedVertices: [{ x: 0.1, y: 0.2 }] }
const word = { text: 'Invoice', confidence: 0.98, boundingPolygon: polygon }
const page = {
  pageNumber: 1,
  dimensions: { width: 8.5, height: 11, unit: 'INCH' },
  words: [word],
  lines: [{ ...word, wordIndexes: [0] }],
  tables: [
    {
      rowCount: 1,
      columnCount: 1,
      bodyRows: [{ cells: [{ ...word, rowIndex: 0, columnIndex: 0, wordIndexes: [0] }] }],
    },
  ],
  documentFields: [
    {
      fieldType: 'KEY_VALUE',
      fieldLabel: { name: 'Items', confidence: 0.9 },
      fieldValue: {
        valueType: 'ARRAY',
        items: [
          {
            fieldType: 'KEY_VALUE',
            fieldName: { name: 'Total', boundingPolygon: polygon, wordIndexes: [0] },
            fieldValue: {
              valueType: 'NUMBER',
              value: 12.5,
              text: '$12.50',
              confidence: 0.95,
              normalizedValue: '12.50',
              normalizedConfidence: 0.94,
            },
          },
        ],
      },
    },
  ],
  detectedDocumentTypes: [{ documentType: 'INVOICE', confidence: 0.99 }],
  detectedLanguages: [{ language: 'en', confidence: 0.99 }],
  selectionMarks: [{ state: 'SELECTED', confidence: 0.8, boundingPolygon: polygon }],
}
const result = {
  documentMetadata: { pageCount: 1, mimeType: 'application/pdf' },
  pages: [page],
  textExtractionModelVersion: '2.0',
  errors: [{ code: 'PARTIAL_RESULT', message: 'One feature was unavailable' }],
  searchablePdf: 'must-not-escape',
}

describe('document analysis projection', () => {
  it('preserves documented text, tables, nested field values, confidence and partial errors', () => {
    const output = normalizeDocumentAnalysis(result, projection)
    expect(output.pages[0].text).toBe('Invoice')
    expect(output.pages[0].tables[0].bodyRows[0].cells[0]).toMatchObject({
      text: 'Invoice',
      rowIndex: 0,
      columnIndex: 0,
      confidence: 0.98,
    })
    expect(output.pages[0].documentFields.map((field) => field.path)).toEqual([[0], [0, 0]])
    expect(output.pages[0].documentFields[1].fieldValue).toMatchObject({
      valueType: 'NUMBER',
      numberValue: 12.5,
      normalizedValue: '12.50',
    })
    expect(output.modelVersions).toEqual([{ feature: 'TEXT_EXTRACTION', version: '2.0' }])
    expect(output.errors).toEqual(result.errors)
    expect(output.truncated).toBe(false)
    expect(output).not.toHaveProperty('searchablePdf')
    expect(output.pages[0].words).toBeUndefined()
    expect(output.pages[0].lines[0].wordIndexes).toBeUndefined()
    expect(output.pages[0].lines[0].boundingPolygon).toBeUndefined()
  })

  it('includes geometry and only references retained words when requested', () => {
    const output = normalizeDocumentAnalysis(result, {
      ...projection,
      includeWords: true,
      includeGeometry: true,
    })
    expect(output.pages[0].words?.[0].boundingPolygon).toEqual(polygon)
    expect(output.pages[0].lines[0].wordIndexes).toEqual([0])
    expect(output.pages[0].documentFields[1].fieldName?.boundingPolygon).toEqual(polygon)
  })

  it('selects original pages and explicitly reports page limits', () => {
    const pages = [page, { ...page, pageNumber: 2 }, { ...page, pageNumber: 3 }]
    const output = normalizeDocumentAnalysis(
      { ...result, pages },
      {
        ...projection,
        pageNumbers: [2, 3],
        maxPages: 1,
      }
    )
    expect(output.pages.map((p) => p.pageNumber)).toEqual([2])
    expect(output.availablePageCount).toBe(3)
    expect(output.truncationReasons).toContain('page_limit')
  })

  it('drops indices beyond the words retained within the projection budget', () => {
    const words = [word, { ...word, text: 'x'.repeat(16000) }]
    const output = normalizeDocumentAnalysis(
      {
        ...result,
        pages: [
          {
            ...page,
            words,
            lines: [{ ...word, wordIndexes: [0, 1, 99] }],
          },
        ],
      },
      { ...projection, includeWords: true, maxOutputBytes: 16384 }
    )
    expect(output.pages[0].words).toHaveLength(1)
    expect(output.pages[0].lines[0].wordIndexes).toEqual([0])
    expect(output.truncationReasons).toContain('output_bytes')
  })

  it.each(['text', 'table'])('keeps useful partial %s content near the byte ceiling', (kind) => {
    const cells = Array.from({ length: 100 }, (_, index) => ({
      text: '界'.repeat(100),
      rowIndex: index,
      columnIndex: 0,
    }))
    const largePage = {
      pageNumber: 1,
      dimensions: page.dimensions,
      lines: kind === 'text' ? cells : [],
      tables:
        kind === 'table'
          ? [
              {
                rowCount: 100,
                columnCount: 1,
                bodyRows: [{ cells }],
              },
            ]
          : [],
    }
    const output = normalizeDocumentAnalysis(
      { ...result, pages: [largePage] },
      {
        ...projection,
        maxOutputBytes: 16384,
      }
    )
    expect(output.pages).toHaveLength(1)
    const retained =
      kind === 'text' ? output.pages[0].lines : output.pages[0].tables[0].bodyRows[0].cells
    expect(retained.length).toBeGreaterThan(0)
    expect(retained.length).toBeLessThan(100)
    expect(output.truncationReasons).toContain('output_bytes')
    expect(
      Buffer.byteLength(JSON.stringify({ success: true, output: { analysis: output } }))
    ).toBeLessThanOrEqual(16384)
  })

  it('bounds nested arrays and rejects malformed provider shapes', () => {
    let field: Record<string, unknown> = { fieldType: 'KEY_VALUE' }
    for (let depth = 0; depth < 12; depth++) {
      field = { fieldType: 'KEY_VALUE', fieldValue: { valueType: 'ARRAY', items: [field] } }
    }
    const output = normalizeDocumentAnalysis(
      {
        ...result,
        pages: [{ ...page, documentFields: [field] }],
      },
      projection
    )
    expect(output.truncationReasons).toContain('field_depth')
    expect(output.pages[0].documentFields).toHaveLength(8)
    expect(() => normalizeDocumentAnalysis({ ...result, pages: null }, projection)).toThrow()
    expect(() =>
      normalizeDocumentAnalysis(
        {
          ...result,
          pages: [{ ...page, lines: [{ text: 'bad', confidence: 2 }] }],
        },
        projection
      )
    ).toThrow()
  })
})

describe('job and model projection', () => {
  it('retains partial failure status without echoed inline content', () => {
    const job = normalizeDocumentJob({
      id: 'job-1',
      compartmentId: 'compartment-1',
      lifecycleState: 'FAILED',
      lifecycleDetails: 'PARTIALLY_SUCCEEDED',
      timeAccepted: '2026-01-01T00:00:00Z',
      outputLocation: { namespaceName: 'namespace', bucketName: 'results', prefix: 'documents' },
      inputLocation: { data: 'private-document-bytes' },
    })
    expect(job).toMatchObject({ terminal: true, partiallySucceeded: true })
    expect(job).not.toHaveProperty('inputLocation')
  })

  it('projects model subtype without training data or guessed version fields', () => {
    const model = normalizeDocumentModel({
      id: 'model-1',
      modelVersion: '2.0',
      version: 'wrong',
      modelSubType: {
        modelType: 'PRE_TRAINED_KEY_VALUE_EXTRACTION',
        modelSubType: 'INVOICE',
        private: 'omit',
      },
      trainingDataset: { data: 'private' },
    })
    expect(model).toEqual({
      id: 'model-1',
      modelVersion: '2.0',
      modelSubType: { modelType: 'PRE_TRAINED_KEY_VALUE_EXTRACTION', modelSubType: 'INVOICE' },
    })
  })
})
