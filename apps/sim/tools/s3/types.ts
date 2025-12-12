import type { ToolResponse } from '@/tools/types'

export interface S3Response extends ToolResponse {
  output: {
    url?: string
    objects?: Array<{
      key: string
      size: number
      lastModified: string
      etag: string
    }>
    deleted?: boolean
    metadata: {
      fileType?: string
      size?: number
      name?: string
      lastModified?: string
      etag?: string
      location?: string
      key?: string
      bucket?: string
      isTruncated?: boolean
      nextContinuationToken?: string
      keyCount?: number
      prefix?: string
      deleteMarker?: boolean
      versionId?: string
      copySourceVersionId?: string
      error?: string
    }
  }
}
