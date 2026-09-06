import type {
  OciResourceManagerCancelJobParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerCancelJobTool: InternalToolConfig<
  OciResourceManagerCancelJobParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_cancel_job',
  name: 'OCI Resource Manager Cancel Job',
  description: 'Request cancellation of a job; acceptance does not imply completed cancellation.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    jobId: { ...ociResourceManagerParams.jobId, required: true },
    ifMatch: { ...ociResourceManagerParams.ifMatch, required: false },
    isForced: { ...ociResourceManagerParams.isForced, required: false },
    confirmForce: { ...ociResourceManagerParams.confirmForce, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    accepted: {
      type: 'boolean',
      description: 'True for accepted asynchronous requests, not completed work',
    },
    stackId: { type: 'string', optional: true, description: 'Affected stack ID' },
    jobId: { type: 'string', optional: true, description: 'Affected job ID' },
  },
}
