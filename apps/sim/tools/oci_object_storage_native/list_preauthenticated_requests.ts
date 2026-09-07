import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_PAR_PROPERTIES,
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeListPreauthenticatedRequestsTool: InternalToolConfig<
  OciObjectStorageNativeParams<'list_preauthenticated_requests'>,
  OciObjectStorageNativeResponse<'list_preauthenticated_requests'>
> = {
  id: 'oci_object_storage_native_list_preauthenticated_requests',
  name: 'OCI Object Storage Native List Pre-Authenticated Requests',
  description:
    'List one page of pre-authenticated request summaries. Access URLs are returned only at creation. Requires PAR_MANAGE or BUCKET_READ.',
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
    objectNamePrefix: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter pre-authenticated requests by exact object-name prefix',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, ['bucketName', 'limit', 'page', 'objectNamePrefix']),
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
    requests: {
      type: 'array',
      description: 'Access-grant summaries without secret URLs',
      items: { type: 'object', properties: OCI_NATIVE_PAR_PROPERTIES },
    },
    nextPage: {
      type: 'string',
      description: 'Opaque next-page token',
      nullable: true,
    },
  },
}
