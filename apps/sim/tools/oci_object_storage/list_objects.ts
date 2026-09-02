import {
  createOciObjectStorageOperationInput,
  ociObjectStorageAuthParamFields,
  ociObjectStorageOAuth,
} from '@/tools/oci_object_storage/shared'
import type {
  OciObjectStorageListObjectsParams,
  OciObjectStorageResponse,
} from '@/tools/oci_object_storage/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageListObjectsTool: InternalToolConfig<
  OciObjectStorageListObjectsParams,
  OciObjectStorageResponse
> = {
  id: 'oci_object_storage_list_objects',
  name: 'OCI Object Storage List Objects',
  description: 'List one page of objects and common prefixes in an OCI bucket',
  version: '1.0.0',
  oauth: ociObjectStorageOAuth,
  params: {
    ...ociObjectStorageAuthParamFields,
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'OCI Object Storage bucket name',
    },
    prefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only object keys beginning with this prefix',
    },
    delimiter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use / to group keys into common prefixes',
    },
    maxKeys: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 100,
      description: 'Maximum objects and prefixes to return (1-1000)',
    },
    startAfter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Begin listing after this object key',
    },
    continuationToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque token returned by the previous truncated page',
    },
  },
  operation: { input: createOciObjectStorageOperationInput },
  outputs: {
    bucket: { type: 'string', description: 'Bucket that was listed' },
    objects: {
      type: 'array',
      description: 'Objects in this page',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Object key' },
          size: { type: 'number', description: 'Object size in bytes' },
          lastModified: {
            type: 'string',
            description: 'Last modification time in ISO 8601 format',
            nullable: true,
          },
          etag: { type: 'string', description: 'Entity tag', nullable: true },
          storageClass: { type: 'string', description: 'Object storage class', nullable: true },
        },
      },
    },
    commonPrefixes: {
      type: 'array',
      description: 'Grouped key prefixes when a delimiter is supplied',
      items: { type: 'string' },
    },
    keyCount: { type: 'number', description: 'Number of results in this page' },
    maxKeys: { type: 'number', description: 'Page size applied by Oracle' },
    isTruncated: { type: 'boolean', description: 'Whether another page is available' },
    nextContinuationToken: {
      type: 'string',
      description: 'Opaque token for the next page',
      nullable: true,
    },
    continuationToken: {
      type: 'string',
      description: 'Opaque token used for this page',
      nullable: true,
    },
    startAfter: { type: 'string', description: 'Start-after key used', nullable: true },
    prefix: { type: 'string', description: 'Prefix applied to this listing', nullable: true },
    delimiter: { type: 'string', description: 'Delimiter applied to this listing', nullable: true },
  },
}
