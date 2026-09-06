import type {
  OciResourceManagerGetJobLogsParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { LOGS_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerGetJobLogsTool: InternalToolConfig<
  OciResourceManagerGetJobLogsParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_get_job_logs',
  name: 'OCI Resource Manager Get Job Logs',
  description: 'Read one page of job logs with messages revealed only when requested.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    jobId: { ...ociResourceManagerParams.jobId, required: true },
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
    includeMessages: { ...ociResourceManagerParams.includeMessages, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    logs: {
      type: 'array',
      description: 'One page of logs metadata with explicit optional projections',
      items: { type: 'object', properties: LOGS_OUTPUTS },
    },
  },
}
