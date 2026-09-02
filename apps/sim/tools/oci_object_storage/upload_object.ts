import {
  createOciObjectStorageOperationInput,
  ociObjectStorageAuthParamFields,
  ociObjectStorageOAuth,
} from '@/tools/oci_object_storage/shared'
import type {
  OciObjectStorageResponse,
  OciObjectStorageUploadObjectParams,
} from '@/tools/oci_object_storage/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageUploadObjectTool: InternalToolConfig<
  OciObjectStorageUploadObjectParams,
  OciObjectStorageResponse
> = {
  id: 'oci_object_storage_upload_object',
  name: 'OCI Object Storage Upload Object',
  description: 'Upload one file or inline text object, replacing an existing key',
  version: '1.0.0',
  oauth: ociObjectStorageOAuth,
  params: {
    ...ociObjectStorageAuthParamFields,
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination OCI bucket name',
    },
    objectKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination object key, including any prefix',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-only',
      description: 'Authorized Sim file to upload',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Inline text to upload instead of a file',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Object Content-Type; inferred from the file when omitted',
    },
  },
  operation: { input: createOciObjectStorageOperationInput },
  outputs: {
    bucket: { type: 'string', description: 'Destination bucket name' },
    key: { type: 'string', description: 'Uploaded object key' },
    size: { type: 'number', description: 'Uploaded size in bytes' },
    contentType: { type: 'string', description: 'Uploaded Content-Type' },
    etag: { type: 'string', description: 'Entity tag returned by Oracle', nullable: true },
    checksumSha256: {
      type: 'string',
      description: 'Base64 SHA-256 checksum when returned by Oracle',
      nullable: true,
    },
    requestId: { type: 'string', description: 'Oracle request identifier', nullable: true },
  },
}
