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

export const ociObjectStorageNativeRenameObjectTool: InternalToolConfig<
  OciObjectStorageNativeParams<'rename_object'>,
  OciObjectStorageNativeResponse<'rename_object'>
> = {
  id: 'oci_object_storage_native_rename_object',
  name: 'OCI Object Storage Native Rename Object',
  description:
    'Rename the current object in the same bucket. Previous versions cannot be renamed. Requires OBJECT_CREATE and OBJECT_OVERWRITE.',
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
    newName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact new object name in the same bucket',
    },
    srcObjIfMatchETag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Require this source ETag before renaming',
    },
    newObjIfMatchETag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Require this destination ETag before renaming',
    },
    newObjIfNoneMatchETag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to * to prevent overwriting the rename destination',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'objectName',
        'newName',
        'srcObjIfMatchETag',
        'newObjIfMatchETag',
        'newObjIfNoneMatchETag',
      ]),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    ...OCI_NATIVE_OBJECT_OUTPUTS,
  },
}
