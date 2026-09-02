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

export const ociObjectStorageDownloadObjectTool: InternalToolConfig<
  OciObjectStorageObjectParams,
  OciObjectStorageResponse
> = {
  id: 'oci_object_storage_download_object',
  name: 'OCI Object Storage Download Object',
  description: 'Download an OCI object of up to 100 MiB into the workflow file system',
  version: '1.0.0',
  oauth: ociObjectStorageOAuth,
  params: {
    ...ociObjectStorageAuthParamFields,
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source OCI bucket name',
    },
    objectKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Object key to download',
    },
  },
  operation: { input: createOciObjectStorageOperationInput },
  outputs: {
    file: { type: 'file', description: 'Downloaded file stored in execution files' },
    bucket: { type: 'string', description: 'Source bucket name' },
    key: { type: 'string', description: 'Downloaded object key' },
    contentLength: { type: 'number', description: 'Downloaded size in bytes' },
    contentType: { type: 'string', description: 'Object Content-Type' },
    etag: { type: 'string', description: 'Entity tag', nullable: true },
    lastModified: {
      type: 'string',
      description: 'Last modification time in ISO 8601 format',
      nullable: true,
    },
    metadata: { type: 'json', description: 'User-defined object metadata' },
    requestId: { type: 'string', description: 'Oracle request identifier', nullable: true },
  },
}
