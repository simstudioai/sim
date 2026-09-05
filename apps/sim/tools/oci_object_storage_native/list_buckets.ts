import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_BUCKET_PROPERTIES,
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeListBucketsTool: InternalToolConfig<
  OciObjectStorageNativeParams<'list_buckets'>,
  OciObjectStorageNativeResponse<'list_buckets'>
> = {
  id: 'oci_object_storage_native_list_buckets',
  name: 'OCI Object Storage Native List Buckets',
  description: 'List one page of buckets in a compartment. Requires BUCKET_INSPECT.',
  version: '1.0.0',
  oauth: ociNativeOAuth,
  params: {
    ...ociNativeAuthParams,
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'OCI compartment OCID',
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
    input: (params) => createOciNativeOperationInput(params, ['compartmentId', 'limit', 'page']),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    namespace: {
      type: 'string',
      description: 'Object Storage namespace',
    },
    buckets: {
      type: 'array',
      description: 'Bucket summaries',
      items: { type: 'object', properties: OCI_NATIVE_BUCKET_PROPERTIES },
    },
    nextPage: {
      type: 'string',
      description: 'Opaque token for the next page',
      nullable: true,
    },
  },
}
