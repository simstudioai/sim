import { ToolResponse } from '../types'

export interface S3Response extends ToolResponse {
  output: {
    content: string       // Processed content (text for text files, URL for others)
    data: string          // Base64 encoded data for the file
    metadata: {
      fileName: string
      contentType: string
      fileSize: number
      lastModified: string
    }
  }
}