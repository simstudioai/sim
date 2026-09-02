import {
  createOciObjectStorageOperationInput,
  ociObjectStorageAuthParamFields,
  ociObjectStorageOAuth,
} from '@/tools/oci_object_storage/shared'
import type {
  OciObjectStorageAuthParams,
  OciObjectStorageResponse,
} from '@/tools/oci_object_storage/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageListBucketsTool: InternalToolConfig<
  OciObjectStorageAuthParams,
  OciObjectStorageResponse
> = {
  id: 'oci_object_storage_list_buckets',
  name: 'OCI Object Storage List Buckets',
  description: 'List the buckets visible to a connected OCI Customer Secret Key',
  version: '1.0.0',
  oauth: ociObjectStorageOAuth,
  params: ociObjectStorageAuthParamFields,
  operation: { input: createOciObjectStorageOperationInput },
  outputs: {
    buckets: {
      type: 'array',
      description: 'OCI Object Storage buckets visible in the connected region',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Bucket name' },
          creationDate: {
            type: 'string',
            description: 'Bucket creation time in ISO 8601 format',
            nullable: true,
          },
        },
      },
    },
    owner: {
      type: 'object',
      description: 'Oracle owner identity returned by GetService',
      nullable: true,
      properties: {
        id: { type: 'string', description: 'Owner identifier', nullable: true },
        displayName: { type: 'string', description: 'Owner display name', nullable: true },
      },
    },
  },
}
