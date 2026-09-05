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

export const ociObjectStorageNativeCommitMultipartUploadTool: InternalToolConfig<
  OciObjectStorageNativeParams<'commit_multipart_upload'>,
  OciObjectStorageNativeResponse<'commit_multipart_upload'>
> = {
  id: 'oci_object_storage_native_commit_multipart_upload',
  name: 'OCI Object Storage Native Commit Multipart Upload',
  description:
    'Commit an explicit manifest of up to 10000 unique partNum/etag entries, with optional non-overlapping exclusions. Requires BUCKET_READ, OBJECT_CREATE, OBJECT_READ and OBJECT_OVERWRITE.',
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
    partsToCommit: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: '1–10000 unique {partNum, etag} entries in the completion manifest',
      minItems: 1,
      maxItems: 10000,
      items: {
        type: 'object',
        required: ['partNum', 'etag'],
        additionalProperties: false,
        properties: {
          partNum: { type: 'integer', minimum: 1, maximum: 10000 },
          etag: { type: 'string' },
        },
      },
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
    partsToExclude: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique part numbers to exclude, disjoint from partsToCommit',
      maxItems: 10000,
      items: { type: 'integer', minimum: 1, maximum: 10000 },
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'objectName',
        'uploadId',
        'partsToCommit',
        'ifMatch',
        'ifNoneMatch',
        'partsToExclude',
      ]),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    ...OCI_NATIVE_OBJECT_OUTPUTS,
    uploadId: {
      type: 'string',
      description: 'Multipart upload identifier',
    },
  },
}
