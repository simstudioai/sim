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

export const ociObjectStorageNativeAbortMultipartUploadTool: InternalToolConfig<
  OciObjectStorageNativeParams<'abort_multipart_upload'>,
  OciObjectStorageNativeResponse<'abort_multipart_upload'>
> = {
  id: 'oci_object_storage_native_abort_multipart_upload',
  name: 'OCI Object Storage Native Abort Multipart Upload',
  description:
    'Abort an unfinished multipart upload and discard its uploaded parts. Requires OBJECT_DELETE.',
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
    uploadId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Native multipart upload identifier',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, ['bucketName', 'objectName', 'uploadId']),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    ...OCI_NATIVE_OBJECT_OUTPUTS,
    uploadId: {
      type: 'string',
      description: 'Multipart upload identifier',
    },
    aborted: {
      type: 'boolean',
      description: 'Upload aborted and parts discarded',
    },
  },
}
