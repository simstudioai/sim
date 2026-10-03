import type {
  OciResourceManagerGetWorkRequestLogsParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { LOGS_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerGetWorkRequestLogsTool: InternalToolConfig<
  OciResourceManagerGetWorkRequestLogsParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_get_work_request_logs',
  name: 'OCI Resource Manager Get Work Request Logs',
  description:
    'Read service or Terraform work-request logs, optionally downloading Terraform logs.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    workRequestId: { ...ociResourceManagerParams.workRequestId, required: true },
    kind: { ...ociResourceManagerParams.kind, required: true },
    limit: { ...ociResourceManagerParams.limit, required: false },
    page: { ...ociResourceManagerParams.page, required: false },
    type: { ...ociResourceManagerParams.type, required: false },
    levelGreaterThanOrEqualTo: {
      ...ociResourceManagerParams.levelGreaterThanOrEqualTo,
      required: false,
    },
    sortOrder: { ...ociResourceManagerParams.sortOrder, required: false },
    timestampGreaterThanOrEqualTo: {
      ...ociResourceManagerParams.timestampGreaterThanOrEqualTo,
      required: false,
    },
    timestampLessThanOrEqualTo: {
      ...ociResourceManagerParams.timestampLessThanOrEqualTo,
      required: false,
    },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: false },
    includeMessages: { ...ociResourceManagerParams.includeMessages, required: false },
    outputMode: { ...ociResourceManagerParams.outputMode, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    logs: {
      type: 'array',
      optional: true,
      description: 'One page of logs metadata with explicit optional projections',
      items: { type: 'object', properties: LOGS_OUTPUTS },
    },
    file: {
      type: 'file',
      optional: true,
      description: 'Terraform logs file instead of entries when outputMode=file',
    },
  },
}
