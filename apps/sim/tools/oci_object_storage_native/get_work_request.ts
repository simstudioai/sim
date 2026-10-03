import {
  createOciNativeOperationInput,
  ociNativeAuthParams,
  ociNativeOAuth,
} from '@/tools/oci_object_storage_native/shared'
import {
  OCI_NATIVE_REQUEST_ID_OUTPUT,
  OCI_NATIVE_RESOURCE_PROPERTIES,
  OCI_NATIVE_WORK_REQUEST_PROPERTIES,
  type OciObjectStorageNativeParams,
  type OciObjectStorageNativeResponse,
} from '@/tools/oci_object_storage_native/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociObjectStorageNativeGetWorkRequestTool: InternalToolConfig<
  OciObjectStorageNativeParams<'get_work_request'>,
  OciObjectStorageNativeResponse<'get_work_request'>
> = {
  id: 'oci_object_storage_native_get_work_request',
  name: 'OCI Object Storage Native Get Work Request',
  description:
    'Poll a work request once. Copy status completes with COMPLETED or FAILED; this tool does not wait. Requires permission to read the affected resource.',
  version: '1.0.0',
  oauth: ociNativeOAuth,
  params: {
    ...ociNativeAuthParams,
    workRequestId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Work-request identifier returned by copy',
    },
  },
  operation: { input: (params) => createOciNativeOperationInput(params, ['workRequestId']) },
  outputs: {
    ...OCI_NATIVE_REQUEST_ID_OUTPUT,
    workRequest: {
      type: 'object',
      description: 'id, compartmentId, operationType, status, percentComplete and timestamps',
      properties: OCI_NATIVE_WORK_REQUEST_PROPERTIES,
    },
    resources: {
      type: 'array',
      description: 'Affected resource identifiers and actions',
      items: { type: 'object', properties: OCI_NATIVE_RESOURCE_PROPERTIES },
    },
    retryAfter: {
      type: 'string',
      description: 'Provider retry guidance, when available',
      nullable: true,
    },
  },
}
