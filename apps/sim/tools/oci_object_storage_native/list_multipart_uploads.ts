import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  OCI_NATIVE_UPLOAD_PROPERTIES,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeListMultipartUploadsTool: InternalToolConfig<
  OciObjectStorageNativeParams<'list_multipart_uploads'>,
  OciObjectStorageNativeResponse<'list_multipart_uploads'>
> = {
  id: 'oci_object_storage_native_list_multipart_uploads',
  name: 'OCI Object Storage Native List Multipart Uploads',
  description: 'List one page of active multipart uploads. Requires BUCKET_READ.',
  version: '1.0.0',
  oauth: ociNativeOAuth,
  params: {
    ...ociNativeAuthParams,
    bucketName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'OCI bucket name',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'One-page result limit, default 100, maximum 1000',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Opaque nextPage token from the previous response',
    },
  },
  operation: {
    input: (params) => createOciNativeOperationInput(params, ['bucketName', 'limit', 'page']),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    namespace: {
      type: 'string',
      description: 'Object Storage namespace',
    },
    bucketName: {
      type: 'string',
      description: 'Bucket name',
    },
    uploads: {
      type: 'array',
      description: 'Active multipart uploads',
      items: { type: 'object', properties: OCI_NATIVE_UPLOAD_PROPERTIES },
    },
    nextPage: {
      type: 'string',
      description: 'Opaque next-page token',
      nullable: true,
    },
  },
}
