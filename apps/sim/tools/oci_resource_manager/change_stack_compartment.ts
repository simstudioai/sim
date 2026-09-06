import type {
  OciResourceManagerChangeStackCompartmentParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerChangeStackCompartmentTool: InternalToolConfig<
  OciResourceManagerChangeStackCompartmentParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_change_stack_compartment',
  name: 'OCI Resource Manager Change Stack Compartment',
  description: 'Start moving a stack to another compartment and return its work-request ID.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    stackId: { ...ociResourceManagerParams.stackId, required: true },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: true },
    ifMatch: { ...ociResourceManagerParams.ifMatch, required: false },
    retryToken: { ...ociResourceManagerParams.retryToken, required: false },
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
