import type {
  OciResourceManagerGetJobParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { JOB_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerGetJobTool: InternalToolConfig<
  OciResourceManagerGetJobParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_get_job',
  name: 'OCI Resource Manager Get Job',
  description: 'Inspect a job and its status without resubmitting it.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    jobId: { ...ociResourceManagerParams.jobId, required: true },
    includeVariables: { ...ociResourceManagerParams.includeVariables, required: false },
    variableNames: { ...ociResourceManagerParams.variableNames, required: false },
    includeSource: { ...ociResourceManagerParams.includeSource, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    job: {
      type: 'object',
      description: 'job metadata with explicit optional projections',
      properties: JOB_OUTPUTS,
    },
  },
}
