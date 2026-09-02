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

export const ociObjectStorageDeleteObjectTool: InternalToolConfig<
  OciObjectStorageObjectParams,
  OciObjectStorageResponse
> = {
  id: 'oci_object_storage_delete_object',
  name: 'OCI Object Storage Delete Object',
  description: 'Delete one object from an OCI bucket',
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
      description: 'Object key to delete',
    },
  },
  operation: { input: createOciObjectStorageOperationInput },
  outputs: {
    deleted: { type: 'boolean', description: 'Whether Oracle accepted the deletion' },
    bucket: { type: 'string', description: 'Bucket name' },
    key: { type: 'string', description: 'Deleted object key' },
    requestId: { type: 'string', description: 'Oracle request identifier', nullable: true },
  },
}
