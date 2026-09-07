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

export const ociObjectStorageNativeUploadPartTool: InternalToolConfig<
  OciObjectStorageNativeParams<'upload_part'>,
  OciObjectStorageNativeResponse<'upload_part'>
> = {
  id: 'oci_object_storage_native_upload_part',
  name: 'OCI Object Storage Native Upload Part',
  description:
    'Upload one part numbered 1–10000 from a file up to 100 MiB or UTF-8 text within the 8 MiB JSON request limit. Save the returned ETag for commit. Requires OBJECT_CREATE and OBJECT_OVERWRITE.',
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
    partNumber: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Multipart part number, 1–10000',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Uploaded workflow file; exactly one of file or content, maximum 100 MiB',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Inline UTF-8 text, including empty text; the complete JSON request must fit within 8 MiB, including escaping and other fields. Use a file for larger uploads.',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content MIME type; inferred for files, text/plain for inline content',
    },
    contentMd5: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional base64 MD5 checksum of the exact uploaded bytes',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Apply only if the entity tag matches',
    },
    ifNoneMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to * to apply only when the destination does not exist',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'objectName',
        'uploadId',
        'partNumber',
        'file',
        'content',
        'contentType',
        'contentMd5',
        'ifMatch',
        'ifNoneMatch',
      ]),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    ...OCI_NATIVE_OBJECT_OUTPUTS,
    size: {
      type: 'number',
      description: 'Uploaded byte length',
    },
    uploadId: {
      type: 'string',
      description: 'Multipart upload identifier',
    },
    partNumber: {
      type: 'number',
      description: 'Uploaded part number',
    },
  },
}
