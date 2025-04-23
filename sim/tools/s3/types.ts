import { ToolResponse } from '../types'

export interface S3Response extends ToolResponse {
  output: {
    url: string         // Presigned URL for direct access
    metadata: {
      fileName: string
      contentType: string
      fileSize: number
      lastModified: string
      error?: string    // Optional error message
    }
  }
}