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

interface TextractDocumentMetadataRaw {
  Pages: number
}

interface TextractDocumentMetadata {
  pages: number
}

interface TextractApiResponse {
  Blocks: TextractBlock[]
  DocumentMetadata: TextractDocumentMetadataRaw
  AnalyzeDocumentModelVersion?: string
  DetectDocumentTextModelVersion?: string
}

interface TextractNormalizedOutput {
  blocks: TextractBlock[]
  documentMetadata: TextractDocumentMetadata
  modelVersion?: string
}

interface TextractAsyncJobResponse {
  JobStatus: 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'PARTIAL_SUCCESS'
  StatusMessage?: string
  Blocks?: TextractBlock[]
  DocumentMetadata?: TextractDocumentMetadataRaw
  NextToken?: string
  AnalyzeDocumentModelVersion?: string
  DetectDocumentTextModelVersion?: string
}

interface TextractStartJobResponse {
  JobId: string
}

export interface TextractParserOutput extends ToolResponse {
  output: TextractNormalizedOutput
}
