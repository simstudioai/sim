import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface S3Response extends ToolResponse {
  output: {
    url?: string
    uri?: string
    file?: UserFile
    objects?: Array<{
      key: string
      size: number
      lastModified: string
      etag: string
    }>
    buckets?: Array<{
      name: string
      creationDate: string | null
      region: string | null
    }>
    deleted?:
      | boolean
      | Array<{ key: string | null; versionId: string | null; deleteMarker: boolean | null }>
    errors?: Array<{ key: string | null; code: string | null; message: string | null }>
    exists?: boolean
    metadata: {
      fileType?: string | null
      size?: number | null
      name?: string
      lastModified?: string | null
      etag?: string | null
      location?: string | null
      key?: string
      bucket?: string
      isTruncated?: boolean
      nextContinuationToken?: string | null
      keyCount?: number
      prefix?: string | null
      deleteMarker?: boolean | null
      versionId?: string | null
      copySourceVersionId?: string
      storageClass?: string | null
      serverSideEncryption?: string | null
      userMetadata?: Record<string, string>
      owner?: { displayName: string | null; id: string | null } | null
      continuationToken?: string | null
      bucketArn?: string | null
      method?: string
      expiresIn?: number
      expiresAt?: string
      deletedCount?: number
      errorCount?: number
      error?: string
    }
  }
}
