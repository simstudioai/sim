import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_DELETED_PROPERTIES,
  OCI_NATIVE_FAILED_PROPERTIES,
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeBatchDeleteObjectsTool: InternalToolConfig<
  OciObjectStorageNativeParams<'batch_delete_objects'>,
  OciObjectStorageNativeResponse<'batch_delete_objects'>
> = {
  id: 'oci_object_storage_native_batch_delete_objects',
  name: 'OCI Object Storage Native Batch Delete Objects',
  description:
    'Delete up to 1000 explicitly named current objects. Preserve individual failures even when OCI returns HTTP 200. Version IDs are not supported by this API. Requires OBJECT_DELETE.',
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
    objects: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description: '1–1000 entries containing objectName and optional ifMatch; no versionId',
      minItems: 1,
      maxItems: 1000,
      items: {
        type: 'object',
        required: ['objectName'],
        additionalProperties: false,
        properties: { objectName: { type: 'string' }, ifMatch: { type: 'string' } },
      },
    },
    isSkipDeletedResult: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Omit successfully deleted entries from the result; failures remain visible',
    },
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, ['bucketName', 'objects', 'isSkipDeletedResult']),
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
    deleted: {
      type: 'array',
      description: 'Successful entries: objectName and timeLastModified',
      items: { type: 'object', properties: OCI_NATIVE_DELETED_PROPERTIES },
    },
    failed: {
      type: 'array',
      description: 'Failed entries: objectName, statusCode and errorMessage',
      items: { type: 'object', properties: OCI_NATIVE_FAILED_PROPERTIES },
    },
    allSucceeded: {
      type: 'boolean',
      description: 'False when any object deletion failed',
    },
  },
}
