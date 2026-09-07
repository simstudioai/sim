import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_BUCKET_PROPERTIES,
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeCreateBucketTool: InternalToolConfig<
  OciObjectStorageNativeParams<'create_bucket'>,
  OciObjectStorageNativeResponse<'create_bucket'>
> = {
  id: 'oci_object_storage_native_create_bucket',
  name: 'OCI Object Storage Native Create Bucket',
  description: 'Create a private bucket. Requires BUCKET_CREATE. Versioning defaults to Disabled.',
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
    compartmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'OCI compartment OCID',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Custom metadata object; object uploads use unprefixed header-safe keys and at most 4000 UTF-8 bytes including header names',
    },
    freeformTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Freeform tag name/value object',
    },
    definedTags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Defined tag namespaces and values',
    },
    autoTiering: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Disabled or InfrequentAccess',
    },
    objectEventsEnabled: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Emit events for object state changes',
    },
    versioning: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Create: Enabled or Disabled; update: Enabled or Suspended',
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
        'compartmentId',
        'metadata',
        'freeformTags',
        'definedTags',
        'autoTiering',
        'objectEventsEnabled',
        'versioning',
        'storageTier',
      ]),
  },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    bucket: {
      type: 'object',
      description:
        'Bucket configuration, including namespace, name, compartmentId, versioning, storageTier, metadata and tags',
      properties: OCI_NATIVE_BUCKET_PROPERTIES,
    },
    etag: {
      type: 'string',
      description: 'Bucket entity tag',
      nullable: true,
    },
  },
}
