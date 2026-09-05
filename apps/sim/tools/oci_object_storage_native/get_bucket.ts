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

export const ociObjectStorageNativeGetBucketTool: InternalToolConfig<
  OciObjectStorageNativeParams<'get_bucket'>,
  OciObjectStorageNativeResponse<'get_bucket'>
> = {
  id: 'oci_object_storage_native_get_bucket',
  name: 'OCI Object Storage Native Get Bucket',
  description:
    'Get bucket configuration and approximate object count and size. Requires BUCKET_READ.',
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
    bucket: {
      type: 'object',
      description:
        'Bucket configuration, including namespace, name, compartmentId, versioning, storageTier, metadata and tags',
      properties: OCI_NATIVE_BUCKET_PROPERTIES,
    },
    etag: {
      type: 'string',
      description: 'Bucket entity tag',
      nullable: true,
    },
  },
}
