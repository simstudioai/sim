import type {
  OciResourceManagerListJobsParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { JOB_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListJobsTool: InternalToolConfig<
  OciResourceManagerListJobsParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_jobs',
  name: 'OCI Resource Manager List Jobs',
  description: 'List one page of jobs for a stack.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    stackId: { ...ociResourceManagerParams.stackId, required: true },
    limit: { ...ociResourceManagerParams.limit, required: false },
    page: { ...ociResourceManagerParams.page, required: false },
    sortBy: { ...ociResourceManagerParams.sortBy, required: false },
    sortOrder: { ...ociResourceManagerParams.sortOrder, required: false },
    displayName: { ...ociResourceManagerParams.displayName, required: false },
    id: { ...ociResourceManagerParams.id, required: false },
    lifecycleState: { ...ociResourceManagerParams.lifecycleState, required: false },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    jobs: {
      type: 'array',
      description: 'One page of jobs metadata with explicit optional projections',
      items: { type: 'object', properties: JOB_OUTPUTS },
    },
  },
}
