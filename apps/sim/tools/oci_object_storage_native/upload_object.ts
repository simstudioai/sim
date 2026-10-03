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

export const ociObjectStorageNativeUploadObjectTool: InternalToolConfig<
  OciObjectStorageNativeParams<'upload_object'>,
  OciObjectStorageNativeResponse<'upload_object'>
> = {
  id: 'oci_object_storage_native_upload_object',
  name: 'OCI Object Storage Native Upload Object',
  description:
    'Upload exactly one file up to 100 MiB or UTF-8 text within the 8 MiB JSON request limit. Empty text is supported. Requires OBJECT_CREATE or OBJECT_OVERWRITE.',
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
    contentLanguage: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content-Language header',
    },
    contentEncoding: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content-Encoding header',
    },
    contentDisposition: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content-Disposition header',
    },
    cacheControl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cache-Control header',
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
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom metadata object; object uploads use unprefixed header-safe keys and at most 4000 UTF-8 bytes including header names',
    },
    storageTier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Standard, InfrequentAccess, or Archive; bucket creation supports Standard or Archive',
    },
    contentMd5: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional base64 MD5 checksum of the exact uploaded bytes',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'objectName',
        'file',
        'content',
        'contentType',
        'contentLanguage',
        'contentEncoding',
        'contentDisposition',
        'cacheControl',
        'ifMatch',
        'ifNoneMatch',
        'metadata',
        'storageTier',
        'contentMd5',
      ]),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    ...OCI_NATIVE_OBJECT_OUTPUTS,
    size: {
      type: 'number',
      description: 'Uploaded byte length',
    },
  },
}
