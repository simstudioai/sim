import type { ToolResponse } from '@/tools/types'

export interface MistralParserInput {
  filePath: string
  fileUpload?: any
  _internalFilePath?: string
  apiKey: string
  resultType?: 'markdown' | 'text' | 'json'
  includeImageBase64?: boolean
  pages?: number[]
  imageLimit?: number
  imageMinSize?: number
}

export interface MistralOcrUsageInfo {
  pagesProcessed: number
  docSizeBytes: number | null
}

export interface MistralParserMetadata {
  jobId: string
  fileType: string
  fileName: string
  source: 'url'
  sourceUrl?: string
  pageCount: number
  usageInfo?: MistralOcrUsageInfo
  model: string
  resultType?: 'markdown' | 'text' | 'json'
  processedAt: string
}

export interface MistralParserOutputData {
  content: string
  metadata: MistralParserMetadata
}

export interface MistralParserOutput extends ToolResponse {
  output: MistralParserOutputData
}

export interface MistralOcrImage {
  id: string
  top_left_x: number
  top_left_y: number
  bottom_right_x: number
  bottom_right_y: number
  image_base64?: string
}

export interface MistralOcrDimensions {
  dpi: number
  height: number
  width: number
}

export interface MistralOcrPage {
  index: number
  markdown: string
  images: MistralOcrImage[]
  dimensions: MistralOcrDimensions
  tables: unknown[]
  hyperlinks: unknown[]
  header: string | null
  footer: string | null
}

export interface MistralOcrUsageInfoRaw {
  pages_processed: number
  doc_size_bytes: number | null
}

export interface MistralParserV2Output extends ToolResponse {
  output: {
    pages: MistralOcrPage[]
    model: string
    usage_info: MistralOcrUsageInfoRaw
    document_annotation: string | null
  }
}
