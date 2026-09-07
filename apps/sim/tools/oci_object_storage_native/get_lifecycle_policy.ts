import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  OCI_NATIVE_RULE_PROPERTIES,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeGetLifecyclePolicyTool: InternalToolConfig<
  OciObjectStorageNativeParams<'get_lifecycle_policy'>,
  OciObjectStorageNativeResponse<'get_lifecycle_policy'>
> = {
  id: 'oci_object_storage_native_get_lifecycle_policy',
  name: 'OCI Object Storage Native Get Lifecycle Policy',
  description: 'Read the complete bucket lifecycle policy. Requires BUCKET_READ.',
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
  },
  operation: { input: (params) => createOciNativeOperationInput(params, ['bucketName']) },
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
    rules: {
      type: 'array',
      description: 'Complete lifecycle rules',
      items: { type: 'object', properties: OCI_NATIVE_RULE_PROPERTIES },
    },
    timeCreated: {
      type: 'string',
      description: 'Policy creation time',
      nullable: true,
    },
    etag: {
      type: 'string',
      description: 'Policy entity tag',
      nullable: true,
    },
  },
}
