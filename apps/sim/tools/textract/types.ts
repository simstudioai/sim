import type { RawFileInput } from '@/lib/uploads/utils/file-utils'
import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export type TextractProcessingMode = 'sync' | 'async'

export interface TextractParserInput {
  accessKeyId: string
  secretAccessKey: string
  region: string
  processingMode?: TextractProcessingMode
  filePath?: string
  file?: RawFileInput
  s3Uri?: string
  fileUpload?: RawFileInput
  featureTypes?: TextractFeatureType[]
  queries?: TextractQuery[]
}

export interface TextractParserV2Input {
  accessKeyId: string
  secretAccessKey: string
  region: string
  processingMode?: TextractProcessingMode
  file?: UserFile
  s3Uri?: string
  featureTypes?: TextractFeatureType[]
  queries?: TextractQuery[]
}

export type TextractFeatureType = 'TABLES' | 'FORMS' | 'QUERIES' | 'SIGNATURES' | 'LAYOUT'

interface TextractQuery {
  Text: string
  Alias?: string
  Pages?: string[]
}

interface TextractBoundingBox {
  Height: number
  Left: number
  Top: number
  Width: number
}

interface TextractPolygonPoint {
  X: number
  Y: number
}

interface TextractGeometry {
  BoundingBox: TextractBoundingBox
  Polygon: TextractPolygonPoint[]
  RotationAngle?: number
}

interface TextractRelationship {
  Type: string
  Ids: string[]
}

interface TextractBlock {
  BlockType: string
  Id: string
  Text?: string
  TextType?: string
  Confidence?: number
  Geometry?: TextractGeometry
  Relationships?: TextractRelationship[]
  Page?: number
  EntityTypes?: string[]
  SelectionStatus?: string
  RowIndex?: number
  ColumnIndex?: number
  RowSpan?: number
  ColumnSpan?: number
  Query?: {
    Text: string
    Alias?: string
    Pages?: string[]
  }
}

interface TextractDocumentMetadata {
  pages: number
}

interface TextractNormalizedOutput {
  blocks: TextractBlock[]
  documentMetadata: TextractDocumentMetadata
  modelVersion?: string
}

export interface TextractParserOutput extends ToolResponse {
  output: TextractNormalizedOutput
}

export interface TextractAnalyzeExpenseInput {
  accessKeyId: string
  secretAccessKey: string
  region: string
  processingMode?: TextractProcessingMode
  filePath?: string
  file?: RawFileInput
  s3Uri?: string
}

export interface TextractAnalyzeExpenseV2Input {
  accessKeyId: string
  secretAccessKey: string
  region: string
  processingMode?: TextractProcessingMode
  file?: UserFile
  s3Uri?: string
}

interface TextractCurrency {
  code?: string
  confidence?: number
}

interface TextractExpenseFieldValue {
  text?: string
  confidence?: number
}

interface TextractExpenseField {
  type?: TextractExpenseFieldValue
  valueDetection?: TextractExpenseFieldValue
  labelDetection?: TextractExpenseFieldValue
  pageNumber?: number
  currency?: TextractCurrency
  groupProperties?: { id: string; types: string[] }[]
}

interface TextractLineItem {
  lineItemExpenseFields: TextractExpenseField[]
}

interface TextractLineItemGroup {
  lineItemGroupIndex?: number
  lineItems: TextractLineItem[]
}

interface TextractExpenseDocument {
  expenseIndex?: number
  summaryFields: TextractExpenseField[]
  lineItemGroups: TextractLineItemGroup[]
}

export interface TextractAnalyzeExpenseOutput extends ToolResponse {
  output: {
    expenseDocuments: TextractExpenseDocument[]
    documentMetadata: TextractDocumentMetadata
    modelVersion?: string
  }
}

export interface TextractAnalyzeIdInput {
  accessKeyId: string
  secretAccessKey: string
  region: string
  filePath?: string
  file?: RawFileInput
  filePathBack?: string
  fileBack?: RawFileInput
}

export interface TextractAnalyzeIdV2Input {
  accessKeyId: string
  secretAccessKey: string
  region: string
  file?: UserFile
  fileBack?: UserFile
}

interface TextractIdFieldValue {
  text?: string
  confidence?: number
  normalizedValue?: { value?: string; valueType?: string }
}

interface TextractIdentityDocumentField {
  type?: TextractIdFieldValue
  valueDetection?: TextractIdFieldValue
}

interface TextractIdentityDocument {
  documentIndex?: number
  identityDocumentFields: TextractIdentityDocumentField[]
}

export interface TextractAnalyzeIdOutput extends ToolResponse {
  output: {
    identityDocuments: TextractIdentityDocument[]
    documentMetadata: TextractDocumentMetadata
    modelVersion?: string
  }
}
