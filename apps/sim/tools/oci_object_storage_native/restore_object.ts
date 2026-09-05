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

export const ociObjectStorageNativeRestoreObjectTool: InternalToolConfig<
  OciObjectStorageNativeParams<'restore_object'>,
  OciObjectStorageNativeResponse<'restore_object'>
> = {
  id: 'oci_object_storage_native_restore_object',
  name: 'OCI Object Storage Native Restore Object',
  description:
    'Request temporary access to an archived object for 1–240 hours (default 24). Restoration is asynchronous. Requires OBJECT_RESTORE.',
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
    versionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Explicit object version ID; deletion permanently removes this version',
    },
    hours: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restore duration in hours, 1–240, default 24',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, ['bucketName', 'objectName', 'versionId', 'hours']),
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
      description: 'Restore request accepted; restoration can still be in progress',
    },
    versionId: {
      type: 'string',
      description: 'Requested version',
      nullable: true,
    },
  },
}
