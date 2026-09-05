import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  OCI_NATIVE_UPLOAD_PROPERTIES,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeCreateMultipartUploadTool: InternalToolConfig<
  OciObjectStorageNativeParams<'create_multipart_upload'>,
  OciObjectStorageNativeResponse<'create_multipart_upload'>
> = {
  id: 'oci_object_storage_native_create_multipart_upload',
  name: 'OCI Object Storage Native Create Multipart Upload',
  description:
    'Initiate a native multipart upload. Save uploadId for uploading parts and committing or aborting. Requires OBJECT_CREATE and OBJECT_OVERWRITE.',
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
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'objectName',
        'contentType',
        'contentLanguage',
        'contentEncoding',
        'contentDisposition',
        'cacheControl',
        'ifMatch',
        'ifNoneMatch',
        'metadata',
        'storageTier',
      ]),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    upload: {
      type: 'object',
      description:
        'Multipart upload: namespace, bucket, object, uploadId, timeCreated and storageTier',
      properties: OCI_NATIVE_UPLOAD_PROPERTIES,
    },
  },
}
