import { isPlainRecord } from '@sim/utils/object'
import { DocumentOperationError } from '@/lib/internal/oci-document-understanding/errors'
import {
  documentOutputSchema,
  type ProjectionInput,
} from '@/lib/internal/oci-document-understanding/schema'
import type {
  DocumentAnalysis,
  DocumentField,
  DocumentGeometry,
  DocumentJob,
  DocumentModel,
  DocumentPage,
  DocumentTable,
  DocumentText,
} from '@/tools/oci_document_understanding/types'

export function documentRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value))
    throw new DocumentOperationError('Unexpected Document Understanding response shape', 502)
  return value
}

function number(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new DocumentOperationError('Unexpected Document Understanding numeric value', 502)
  return value
}

function string(value: unknown, max = 4096): string {
  if (typeof value !== 'string' || value.length > max)
    throw new DocumentOperationError('Unexpected Document Understanding text value', 502)
  return value
}

function array(value: unknown): unknown[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value))
    throw new DocumentOperationError('Unexpected Document Understanding array', 502)
  return value
}

class ProjectionBudget {
  remaining: number
  items = 0
  readonly reasons = new Set<string>()

  constructor(bytes: number) {
    this.remaining = bytes - 8192
  }

  text(value: unknown): string {
    if (typeof value !== 'string')
      throw new DocumentOperationError('Unexpected recognized text', 502)
    if (value.length > 16384) this.reasons.add('string_limit')
    return value.slice(0, 16384)
  }

  take(value: unknown): boolean {
    const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8') + 64
    if (bytes > this.remaining) {
      this.reasons.add('output_bytes')
      return false
    }
    this.remaining -= bytes
    return true
  }

  list<T>(
    value: unknown,
    map: (entry: unknown, index: number) => T | undefined,
    max = 10000,
    charge = true
  ): T[] {
    const source = array(value)
    const output: T[] = []
    for (let i = 0; i < source.length; i++) {
      if (++this.items > 10000 || i >= max) {
        this.reasons.add('item_limit')
        break
      }
      if (this.remaining <= 0) {
        this.reasons.add('output_bytes')
        break
      }
      const entry = map(source[i], i)
      if (entry === undefined) break
      if (charge && !this.take(entry)) break
      output.push(entry)
    }
    return output
  }
}

function confidence(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined
  const result = number(value)
  if (result < 0 || result > 1)
    throw new DocumentOperationError('Unexpected Document Understanding confidence', 502)
  return result
}

function geometry(value: unknown, include: boolean): DocumentGeometry | undefined {
  if (!include || value === undefined || value === null) return undefined
  const vertices = array(documentRecord(value).normalizedVertices)
  if (vertices.length > 16) throw new DocumentOperationError('Unexpected polygon size', 502)
  return {
    normalizedVertices: vertices.map((v) => {
      const point = documentRecord(v)
      return { x: number(point.x), y: number(point.y) }
    }),
  }
}

function wordIndexes(value: unknown, wordCount: number | undefined): number[] | undefined {
  if (wordCount === undefined || value === undefined || value === null) return undefined
  const indices = array(value)
  if (indices.length > 10000) throw new DocumentOperationError('Too many word references', 502)
  return indices.map(number).filter((i) => Number.isInteger(i) && i >= 0 && i < wordCount)
}

function textElement(
  value: unknown,
  budget: ProjectionBudget,
  input: ProjectionInput,
  wordCount?: number
): DocumentText {
  const item = documentRecord(value)
  return {
    text: budget.text(item.text),
    confidence: confidence(item.confidence),
    boundingPolygon: geometry(item.boundingPolygon, input.includeGeometry),
    wordIndexes: wordIndexes(item.wordIndexes, wordCount),
  }
}

function classifications(value: unknown, budget: ProjectionBudget) {
  return budget.list(
    value,
    (entry) => {
      const item = documentRecord(entry)
      return { documentType: string(item.documentType), confidence: number(item.confidence) }
    },
    100
  )
}

function languages(value: unknown, budget: ProjectionBudget) {
  return budget.list(
    value,
    (entry) => {
      const item = documentRecord(entry)
      return { language: string(item.language), confidence: number(item.confidence) }
    },
    100
  )
}

function fields(
  value: unknown,
  budget: ProjectionBudget,
  input: ProjectionInput,
  wordCount?: number,
  parent: number[] = []
): DocumentField[] {
  if (parent.length >= 8) {
    budget.reasons.add('field_depth')
    return []
  }
  const children: DocumentField[] = []
  const current = budget.list(
    value,
    (entry, index): DocumentField | undefined => {
      const item = documentRecord(entry)
      const path = [...parent, index]
      const label = item.fieldLabel == null ? undefined : documentRecord(item.fieldLabel)
      const name = item.fieldName == null ? undefined : documentRecord(item.fieldName)
      const v = item.fieldValue == null ? undefined : documentRecord(item.fieldValue)
      const field: DocumentField = {
        path,
        fieldType: string(item.fieldType),
        fieldLabel: label
          ? { name: budget.text(label.name), confidence: confidence(label.confidence) }
          : undefined,
        fieldName: name
          ? {
              name: budget.text(name.name),
              confidence: confidence(name.confidence),
              boundingPolygon: geometry(name.boundingPolygon, input.includeGeometry),
              wordIndexes: wordIndexes(name.wordIndexes, wordCount),
            }
          : undefined,
        fieldValue: v
          ? {
              valueType: string(v.valueType),
              text: v.text == null ? undefined : budget.text(v.text),
              stringValue: typeof v.value === 'string' ? budget.text(v.value) : undefined,
              numberValue: typeof v.value === 'number' ? number(v.value) : undefined,
              confidence: confidence(v.confidence),
              normalizedValue:
                v.normalizedValue == null ? undefined : budget.text(v.normalizedValue),
              normalizedConfidence: confidence(v.normalizedConfidence),
              boundingPolygon: geometry(v.boundingPolygon, input.includeGeometry),
              wordIndexes: wordIndexes(v.wordIndexes, wordCount),
            }
          : undefined,
      }
      if (!budget.take(field)) return undefined
      if (v?.valueType === 'ARRAY')
        children.push(...fields(v.items, budget, input, wordCount, path))
      return field
    },
    10000,
    false
  )
  return [...current, ...children]
}

function table(
  value: unknown,
  budget: ProjectionBudget,
  input: ProjectionInput,
  wordCount?: number
): DocumentTable | undefined {
  const item = documentRecord(value)
  const output: DocumentTable = {
    rowCount: number(item.rowCount),
    columnCount: number(item.columnCount),
    confidence: confidence(item.confidence),
    boundingPolygon: geometry(item.boundingPolygon, input.includeGeometry),
    headerRows: [],
    bodyRows: [],
    footerRows: [],
  }
  if (!budget.take(output)) return undefined
  const rows = (value: unknown) =>
    budget.list(
      value,
      (row) => {
        if (!budget.take({ cells: [] })) return undefined
        return {
          cells: budget.list(documentRecord(row).cells, (cell) => {
            const item = documentRecord(cell)
            return {
              ...textElement(item, budget, input, wordCount),
              rowIndex: number(item.rowIndex),
              columnIndex: number(item.columnIndex),
            }
          }),
        }
      },
      10000,
      false
    )
  output.headerRows = rows(item.headerRows)
  output.bodyRows = rows(item.bodyRows)
  output.footerRows = rows(item.footerRows)
  return output
}

export function normalizeDocumentAnalysis(
  value: unknown,
  input: ProjectionInput
): DocumentAnalysis {
  const result = documentRecord(value)
  const metadata = documentRecord(result.documentMetadata)
  const sourcePages = array(result.pages)
  if (!Array.isArray(result.pages) || sourcePages.length > 2000) {
    throw new DocumentOperationError('Unexpected document pages', 502)
  }
  const budget = new ProjectionBudget(input.maxOutputBytes)
  const detectedDocumentTypes = classifications(result.detectedDocumentTypes, budget)
  const detectedLanguages = languages(result.detectedLanguages, budget)
  const errors = budget.list(
    result.errors,
    (entry) => {
      const error = documentRecord(entry)
      return { code: string(error.code), message: budget.text(error.message) }
    },
    200
  )
  const modelVersions = Object.entries({
    TEXT_EXTRACTION: 'textExtractionModelVersion',
    TABLE_EXTRACTION: 'tableExtractionModelVersion',
    KEY_VALUE_EXTRACTION: 'keyValueExtractionModelVersion',
    DOCUMENT_CLASSIFICATION: 'documentClassificationModelVersion',
    LANGUAGE_CLASSIFICATION: 'languageClassificationModelVersion',
  }).flatMap(([feature, key]) =>
    typeof result[key] === 'string' ? [{ feature, version: string(result[key], 256) }] : []
  )
  const selected = input.pageNumbers
    ? sourcePages.filter((p) => input.pageNumbers!.includes(number(documentRecord(p).pageNumber)))
    : sourcePages
  if (selected.length > input.maxPages) budget.reasons.add('page_limit')
  const pages = budget.list(
    selected.slice(0, input.maxPages),
    (entry): DocumentPage | undefined => {
      const p = documentRecord(entry)
      const dim = documentRecord(p.dimensions)
      const output: DocumentPage = {
        pageNumber: number(p.pageNumber),
        dimensions: {
          width: number(dim.width),
          height: number(dim.height),
          unit: string(dim.unit),
        },
        text: '',
        lines: [],
        tables: [],
        documentFields: [],
        detectedDocumentTypes: [],
        detectedLanguages: [],
        selectionMarks: [],
      }
      if (!budget.take(output)) return undefined
      const words = input.includeWords
        ? budget.list(p.words, (w) => textElement(w, budget, input))
        : undefined
      const lines = budget.list(p.lines, (l) => textElement(l, budget, input, words?.length))
      output.lines = lines
      output.words = words
      output.tables = budget.list(
        p.tables,
        (t) => table(t, budget, input, words?.length),
        10000,
        false
      )
      output.documentFields = fields(p.documentFields, budget, input, words?.length)
      output.detectedDocumentTypes = classifications(p.detectedDocumentTypes, budget)
      output.detectedLanguages = languages(p.detectedLanguages, budget)
      output.selectionMarks = budget.list(p.selectionMarks, (entry) => {
        const mark = documentRecord(entry)
        return {
          state: string(mark.state),
          confidence: confidence(mark.confidence),
          boundingPolygon: geometry(mark.boundingPolygon, input.includeGeometry),
        }
      })
      const text = lines.map((l) => l.text).join('\n')
      if (budget.take(text)) output.text = text
      return output
    },
    100,
    false
  )
  return {
    documentMetadata: {
      pageCount: number(metadata.pageCount),
      mimeType: string(metadata.mimeType, 256),
    },
    pages,
    detectedDocumentTypes,
    detectedLanguages,
    modelVersions,
    errors,
    truncated: budget.reasons.size > 0,
    truncationReasons: [...budget.reasons],
    returnedPageCount: pages.length,
    availablePageCount: sourcePages.length,
  }
}

export function normalizeDocumentJob(value: unknown): DocumentJob {
  const job = documentRecord(value)
  const state = string(job.lifecycleState)
  if (
    !['ACCEPTED', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'CANCELING', 'CANCELED'].includes(state)
  ) {
    throw new DocumentOperationError('Unknown processor job state', 502)
  }
  const location = documentOutputSchema.safeParse(job.outputLocation)
  if (!location.success) throw new DocumentOperationError('Unexpected job output location', 502)
  return {
    id: string(job.id, 1024),
    compartmentId: string(job.compartmentId, 1024),
    lifecycleState: state,
    displayName: job.displayName == null ? undefined : string(job.displayName),
    lifecycleDetails: job.lifecycleDetails == null ? undefined : string(job.lifecycleDetails),
    timeAccepted: string(job.timeAccepted),
    timeStarted: job.timeStarted == null ? undefined : string(job.timeStarted),
    timeFinished: job.timeFinished == null ? undefined : string(job.timeFinished),
    percentComplete: job.percentComplete == null ? undefined : number(job.percentComplete),
    outputLocation: location.data,
    terminal: ['SUCCEEDED', 'FAILED', 'CANCELED'].includes(state),
    partiallySucceeded: state === 'FAILED' && job.lifecycleDetails === 'PARTIALLY_SUCCEEDED',
  }
}

export function normalizeDocumentModel(value: unknown): DocumentModel {
  const item = documentRecord(value)
  const output: DocumentModel = { id: string(item.id, 1024) }
  for (const key of [
    'displayName',
    'description',
    'compartmentId',
    'projectId',
    'modelType',
    'modelVersion',
    'lifecycleState',
    'lifecycleDetails',
    'timeCreated',
    'timeUpdated',
    'language',
    'aliasName',
    'tenancyId',
  ] as const) {
    if (item[key] != null) output[key] = string(item[key])
  }
  if (item.modelSubType != null) {
    const subtype = documentRecord(item.modelSubType)
    output.modelSubType = {
      modelType: string(subtype.modelType, 256),
      modelSubType: subtype.modelSubType == null ? undefined : string(subtype.modelSubType, 256),
    }
  }
  return output
}

export function documentCursor(value: unknown): string | null {
  return value == null || value === '' ? null : string(value)
}
