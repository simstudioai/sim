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

export const ociObjectStorageNativeUpdateObjectStorageTierTool: InternalToolConfig<
  OciObjectStorageNativeParams<'update_object_storage_tier'>,
  OciObjectStorageNativeResponse<'update_object_storage_tier'>
> = {
  id: 'oci_object_storage_native_update_object_storage_tier',
  name: 'OCI Object Storage Native Update Object Storage Tier',
  description:
    'Change an object or version to Standard, InfrequentAccess, or Archive. Requires OBJECT_UPDATE_TIER.',
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
    storageTier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Standard, InfrequentAccess, or Archive; bucket creation supports Standard or Archive',
    },
    versionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Explicit object version ID; deletion permanently removes this version',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'objectName',
        'storageTier',
        'versionId',
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
    accepted: {
      type: 'boolean',
      description: 'Storage-tier change accepted',
    },
    versionId: {
      type: 'string',
      description: 'Requested version',
      nullable: true,
    },
  },
}
