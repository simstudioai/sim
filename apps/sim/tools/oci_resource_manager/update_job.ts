import type {
  OciResourceManagerResponse,
  OciResourceManagerUpdateJobParams,
} from '@/tools/oci_resource_manager/types'
import { JOB_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerUpdateJobTool: InternalToolConfig<
  OciResourceManagerUpdateJobParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_update_job',
  name: 'OCI Resource Manager Update Job',
  description: 'Update a job display name or tags.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    jobId: { ...ociResourceManagerParams.jobId, required: true },
    displayName: { ...ociResourceManagerParams.displayName, required: false },
    freeformTags: { ...ociResourceManagerParams.freeformTags, required: false },
    definedTags: { ...ociResourceManagerParams.definedTags, required: false },
    ifMatch: { ...ociResourceManagerParams.ifMatch, required: false },
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
