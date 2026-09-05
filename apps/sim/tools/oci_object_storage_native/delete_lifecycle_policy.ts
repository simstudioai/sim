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

export const ociObjectStorageNativeDeleteLifecyclePolicyTool: InternalToolConfig<
  OciObjectStorageNativeParams<'delete_lifecycle_policy'>,
  OciObjectStorageNativeResponse<'delete_lifecycle_policy'>
> = {
  id: 'oci_object_storage_native_delete_lifecycle_policy',
  name: 'OCI Object Storage Native Delete Lifecycle Policy',
  description: 'Delete the complete lifecycle policy. Requires BUCKET_UPDATE.',
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
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apply only if the entity tag matches',
    },
  },
  operation: {
    input: (params) => createOciNativeOperationInput(params, ['bucketName', 'ifMatch']),
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
    deleted: {
      type: 'boolean',
      description: 'Resource deleted or access revoked',
    },
  },
}
