import type { ToolResponse } from '@/tools/types'

export interface S3Response extends ToolResponse {
  output: {
    url: string
    metadata: {
      fileType: string
      size: number
      name: string
      lastModified: string
      error?: string
    }
  }
}
