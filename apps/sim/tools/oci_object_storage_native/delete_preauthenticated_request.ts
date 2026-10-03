import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeDeletePreauthenticatedRequestTool: InternalToolConfig<
  OciObjectStorageNativeParams<'delete_preauthenticated_request'>,
  OciObjectStorageNativeResponse<'delete_preauthenticated_request'>
> = {
  id: 'oci_object_storage_native_delete_preauthenticated_request',
  name: 'OCI Object Storage Native Delete Pre-Authenticated Request',
  description: 'Revoke a pre-authenticated request and its access URL. Requires PAR_MANAGE.',
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
    namespace: {
      type: 'string',
      description: 'Object Storage namespace',
    },
    bucketName: {
      type: 'string',
      description: 'Bucket name',
    },
    deleted: {
      type: 'boolean',
      description: 'Resource deleted or access revoked',
    },
    parId: {
      type: 'string',
      description: 'Revoked access-grant identifier',
    },
  },
}
