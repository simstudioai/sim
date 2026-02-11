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

export interface TextractQuery {
  Text: string
  Alias?: string
  Pages?: string[]
}

export interface TextractBoundingBox {
  Height: number
  Left: number
  Top: number
  Width: number
}

export interface TextractPolygonPoint {
  X: number
  Y: number
}

export interface TextractGeometry {
  BoundingBox: TextractBoundingBox
  Polygon: TextractPolygonPoint[]
  RotationAngle?: number
}

export interface TextractRelationship {
  Type: string
  Ids: string[]
}

export interface TextractBlock {
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

export interface TextractDocumentMetadataRaw {
  Pages: number
}

export interface TextractDocumentMetadata {
  pages: number
}

export interface TextractApiResponse {
  Blocks: TextractBlock[]
  DocumentMetadata: TextractDocumentMetadataRaw
  AnalyzeDocumentModelVersion?: string
  DetectDocumentTextModelVersion?: string
}

export interface TextractNormalizedOutput {
  blocks: TextractBlock[]
  documentMetadata: TextractDocumentMetadata
  modelVersion?: string
}

export interface TextractAsyncJobResponse {
  JobStatus: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL_SUCCESS'
  StatusMessage?: string
  Blocks?: TextractBlock[]
  DocumentMetadata?: TextractDocumentMetadataRaw
  NextToken?: string
  AnalyzeDocumentModelVersion?: string
  DetectDocumentTextModelVersion?: string
}

export interface TextractStartJobResponse {
  JobId: string
}

export interface TextractParserOutput extends ToolResponse {
  output: TextractNormalizedOutput
}
