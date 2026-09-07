import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  OCI_NATIVE_RULE_PROPERTIES,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativePutLifecyclePolicyTool: InternalToolConfig<
  OciObjectStorageNativeParams<'put_lifecycle_policy'>,
  OciObjectStorageNativeResponse<'put_lifecycle_policy'>
> = {
  id: 'oci_object_storage_native_put_lifecycle_policy',
  name: 'OCI Object Storage Native Put Lifecycle Policy',
  description:
    'Replace the entire lifecycle policy with up to 1000 rules. An empty array clears its rules. Requires BUCKET_UPDATE, OBJECT_CREATE, OBJECT_DELETE and regional service permissions for rule actions.',
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
    rules: {
      type: 'array',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Complete replacement lifecycle rule array, maximum 1000. Each rule: name, action, timeAmount, timeUnit, isEnabled; optional target and objectNameFilter. ABORT requires multipart-uploads target. Pattern lists support at most 20 entries.',
      maxItems: 1000,
      items: {
        type: 'object',
        required: ['name', 'action', 'timeAmount', 'timeUnit', 'isEnabled'],
        properties: {
          name: { type: 'string' },
          action: { type: 'string' },
          timeAmount: { type: 'integer', minimum: 1 },
          timeUnit: { type: 'string' },
          isEnabled: { type: 'boolean' },
          target: { type: 'string' },
          objectNameFilter: { type: 'object' },
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
  },
  operation: {
    input: (params) =>
      createOciNativeOperationInput(params, ['bucketName', 'rules', 'ifMatch', 'ifNoneMatch']),
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
    rules: {
      type: 'array',
      description: 'Complete lifecycle rules',
      items: { type: 'object', properties: OCI_NATIVE_RULE_PROPERTIES },
    },
    timeCreated: {
      type: 'string',
      description: 'Policy creation time',
      nullable: true,
    },
    etag: {
      type: 'string',
      description: 'Policy entity tag',
      nullable: true,
    },
  },
}
