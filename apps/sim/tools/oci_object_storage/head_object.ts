import {
  createOciObjectStorageOperationInput,
  ociObjectStorageAuthParamFields,
  ociObjectStorageOAuth,
} from '@/tools/oci_object_storage/shared'
import type {
  OciObjectStorageObjectParams,
  OciObjectStorageResponse,
} from '@/tools/oci_object_storage/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageHeadObjectTool: InternalToolConfig<
  OciObjectStorageObjectParams,
  OciObjectStorageResponse
> = {
  id: 'oci_object_storage_head_object',
  name: 'OCI Object Storage Inspect Object Metadata',
  description: 'Read documented metadata for an OCI object without downloading its body',
  version: '1.0.0',
  oauth: ociObjectStorageOAuth,
  params: {
    ...ociObjectStorageAuthParamFields,
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'OCI bucket name',
    },
    objectKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object key to inspect',
    },
  },
  operation: { input: createOciObjectStorageOperationInput },
  outputs: {
    bucket: { type: 'string', description: 'Bucket name' },
    key: { type: 'string', description: 'Object key' },
    contentLength: { type: 'number', description: 'Object size in bytes', nullable: true },
    contentType: { type: 'string', description: 'Object Content-Type', nullable: true },
    contentEncoding: { type: 'string', description: 'Content-Encoding', nullable: true },
    contentLanguage: { type: 'string', description: 'Content-Language', nullable: true },
    cacheControl: { type: 'string', description: 'Cache-Control value', nullable: true },
    contentDisposition: { type: 'string', description: 'Content-Disposition', nullable: true },
    etag: { type: 'string', description: 'Entity tag', nullable: true },
    lastModified: {
      type: 'string',
      description: 'Last modification time in ISO 8601 format',
      nullable: true,
    },
    storageClass: { type: 'string', description: 'Object storage class', nullable: true },
    metadata: { type: 'json', description: 'User-defined object metadata' },
    checksumSha256: {
      type: 'string',
      description: 'Base64 SHA-256 checksum when returned by Oracle',
      nullable: true,
    },
    requestId: { type: 'string', description: 'Oracle request identifier', nullable: true },
  },
}
