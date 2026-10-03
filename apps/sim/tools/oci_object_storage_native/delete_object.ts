import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_OBJECT_OUTPUTS,
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeDeleteObjectTool: InternalToolConfig<
  OciObjectStorageNativeParams<'delete_object'>,
  OciObjectStorageNativeResponse<'delete_object'>
> = {
  id: 'oci_object_storage_native_delete_object',
  name: 'OCI Object Storage Native Delete Object',
  description:
    'Delete the current object or permanently delete an explicit version. Versioned current-object deletion creates a delete marker. Requires OBJECT_DELETE; explicit versions require OBJECT_VERSION_DELETE.',
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
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apply only if the entity tag matches',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, ['bucketName', 'objectName', 'versionId', 'ifMatch']),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    ...OCI_NATIVE_OBJECT_OUTPUTS,
    deleted: {
      type: 'boolean',
      description: 'Resource deleted or access revoked',
    },
  },
}
