import type { RawFileInput } from '@/lib/uploads/utils/file-schemas'
import type { UserFile } from '@/executor/types'
import type { ToolResponse } from '@/tools/types'

export interface OciObjectStorageAuthParams {
  oauthCredential: string
  accessToken?: string
}

export interface OciObjectStorageObjectParams extends OciObjectStorageAuthParams {
  bucketName: string
  objectKey: string
}

export interface OciObjectStorageListObjectsParams extends OciObjectStorageAuthParams {
  bucketName: string
  prefix?: string
  delimiter?: string
  maxKeys?: number
  startAfter?: string
  continuationToken?: string
}

export interface OciObjectStorageUploadObjectParams extends OciObjectStorageObjectParams {
  file?: RawFileInput | null
  content?: string | null
  contentType?: string
}

export interface OciObjectStorageResponse extends ToolResponse {
  output: {
    buckets?: Array<{ name: string; creationDate: string | null }>
    owner?: { id: string | null; displayName: string | null } | null
    objects?: Array<{
      key: string
      size: number
      lastModified: string | null
      etag: string | null
      storageClass: string | null
    }>
    commonPrefixes?: string[]
    keyCount?: number
    maxKeys?: number
    isTruncated?: boolean
    nextContinuationToken?: string | null
    continuationToken?: string | null
    startAfter?: string | null
    prefix?: string | null
    delimiter?: string | null
    file?: UserFile
    bucket?: string
    key?: string
    deleted?: boolean
    size?: number
    contentLength?: number | null
    contentType?: string | null
    contentEncoding?: string | null
    contentLanguage?: string | null
    cacheControl?: string | null
    contentDisposition?: string | null
    etag?: string | null
    lastModified?: string | null
    storageClass?: string | null
    metadata?: Record<string, string>
    checksumSha256?: string | null
    requestId?: string | null
  }
}
