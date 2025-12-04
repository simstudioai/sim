import type { FileParseResult } from '@/tools/file/types'
import type { ToolResponse } from '@/tools/types'

export type PresentationCreateParams = {
  operation: string
  numberOfSlides: number
  tone: string
  verbosity: string
  template?: string
  content?: string
}

export interface PresentationCreateResponse extends ToolResponse {
  output: {
    presentationFile?: FileParseResult
    presentationId?: string
    message?: string
  }
}
