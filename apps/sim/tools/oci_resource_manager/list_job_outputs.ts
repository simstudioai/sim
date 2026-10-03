import type {
  OciResourceManagerListJobOutputsParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, OUTPUTS_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListJobOutputsTool: InternalToolConfig<
  OciResourceManagerListJobOutputsParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_job_outputs',
  name: 'OCI Resource Manager List Job Outputs',
  description:
    'List one page of Terraform output metadata with explicit selected-value disclosure.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    jobId: { ...ociResourceManagerParams.jobId, required: true },
    limit: { ...ociResourceManagerParams.limit, required: false },
    page: { ...ociResourceManagerParams.page, required: false },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: false },
    includeValues: { ...ociResourceManagerParams.includeValues, required: false },
    outputNames: { ...ociResourceManagerParams.outputNames, required: false },
    includeSensitive: { ...ociResourceManagerParams.includeSensitive, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    outputs: {
      type: 'array',
      description: 'One page of outputs metadata with explicit optional projections',
      items: { type: 'object', properties: OUTPUTS_OUTPUTS },
    },
  },
}
