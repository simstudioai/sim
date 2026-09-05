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

export const ociObjectStorageNativeGetPreauthenticatedRequestTool: InternalToolConfig<
  OciObjectStorageNativeParams<'get_preauthenticated_request'>,
  OciObjectStorageNativeResponse<'get_preauthenticated_request'>
> = {
  id: 'oci_object_storage_native_get_preauthenticated_request',
  name: 'OCI Object Storage Native Get Pre-Authenticated Request',
  description:
    'Get a pre-authenticated request summary; its secret access URL cannot be retrieved again. Requires PAR_MANAGE or BUCKET_READ.',
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
    parId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pre-authenticated request identifier to inspect or revoke',
    },
  },
  operation: { input: (params) => createOciNativeOperationInput(params, ['bucketName', 'parId']) },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    request: {
      type: 'object',
      description: 'Access-grant summary without the secret URL',
      properties: OCI_NATIVE_PAR_PROPERTIES,
    },
  },
}
