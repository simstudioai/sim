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

export const ociObjectStorageNativeGetNamespaceTool: InternalToolConfig<
  OciObjectStorageNativeParams<'get_namespace'>,
  OciObjectStorageNativeResponse<'get_namespace'>
> = {
  id: 'oci_object_storage_native_get_namespace',
  name: 'OCI Object Storage Native Get Namespace',
  description:
    'Get the Object Storage namespace. A compartment query requires OBJECTSTORAGE_NAMESPACE_READ.',
  version: '1.0.0',
  oauth: ociNativeOAuth,
  params: {
    ...ociNativeAuthParams,
    compartmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OCI compartment OCID',
    },
  },
  operation: { input: (params) => createOciNativeOperationInput(params, ['compartmentId']) },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    namespace: {
      type: 'string',
      description: 'Object Storage namespace',
    },
  },
}
