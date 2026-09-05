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

export const ociObjectStorageNativeCopyObjectTool: InternalToolConfig<
  OciObjectStorageNativeParams<'copy_object'>,
  OciObjectStorageNativeResponse<'copy_object'>
> = {
  id: 'oci_object_storage_native_copy_object',
  name: 'OCI Object Storage Native Copy Object',
  description:
    'Start an asynchronous native object copy and return its work-request ID. Requires source OBJECT_READ, destination OBJECT_CREATE/OBJECT_OVERWRITE, and regional Object Storage service permissions.',
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
    destinationRegion: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination OCI region',
    },
    destinationNamespace: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination Object Storage namespace',
    },
    destinationBucket: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Destination bucket name',
    },
    destinationObjectName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Exact destination object name',
    },
    sourceVersionId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source object version to copy',
    },
    sourceObjectIfMatchETag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Require the source object ETag',
    },
    destinationObjectIfMatchETag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Require the destination object ETag',
    },
    destinationObjectIfNoneMatchETag: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to * to prevent overwriting the copy destination',
    },
    destinationObjectMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replacement metadata with unprefixed keys, up to 4000 bytes',
    },
    destinationObjectStorageTier: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Standard, InfrequentAccess, or Archive',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, [
        'bucketName',
        'objectName',
        'destinationRegion',
        'destinationNamespace',
        'destinationBucket',
        'destinationObjectName',
        'sourceVersionId',
        'sourceObjectIfMatchETag',
        'destinationObjectIfMatchETag',
        'destinationObjectIfNoneMatchETag',
        'destinationObjectMetadata',
        'destinationObjectStorageTier',
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
      description: 'Copy request accepted; completion is asynchronous',
    },
    workRequestId: {
      type: 'string',
      description: 'Identifier for get_work_request',
      nullable: true,
    },
  },
}
