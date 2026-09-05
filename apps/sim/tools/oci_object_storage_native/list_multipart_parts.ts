import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_PART_PROPERTIES,
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeListMultipartPartsTool: InternalToolConfig<
  OciObjectStorageNativeParams<'list_multipart_parts'>,
  OciObjectStorageNativeResponse<'list_multipart_parts'>
> = {
  id: 'oci_object_storage_native_list_multipart_parts',
  name: 'OCI Object Storage Native List Multipart Parts',
  description: 'List one page of uploaded parts and their ETags. Requires OBJECT_INSPECT.',
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
    objectName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact object name; preserve spaces, Unicode, separators and percent characters',
    },
    uploadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Native multipart upload identifier',
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
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'objectName',
        'uploadId',
        'limit',
        'page',
      ]),
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
    objectName: {
      type: 'string',
      description: 'Object name',
    },
    parts: {
      type: 'array',
      description: 'Uploaded parts: partNumber, etag, md5 and size',
      items: { type: 'object', properties: OCI_NATIVE_PART_PROPERTIES },
    },
    nextPage: {
      type: 'string',
      description: 'Opaque next-page token',
      nullable: true,
    },
  },
}
