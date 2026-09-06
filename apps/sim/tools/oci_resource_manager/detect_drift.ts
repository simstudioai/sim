import type {
  OciResourceManagerDetectDriftParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerDetectDriftTool: InternalToolConfig<
  OciResourceManagerDetectDriftParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_detect_drift',
  name: 'OCI Resource Manager Detect Drift',
  description: 'Start drift detection and return a work-request identifier.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    stackId: { ...ociResourceManagerParams.stackId, required: true },
    ifMatch: { ...ociResourceManagerParams.ifMatch, required: false },
    retryToken: { ...ociResourceManagerParams.retryToken, required: false },
    resourceAddresses: { ...ociResourceManagerParams.resourceAddresses, required: false },
    isProviderUpgradeRequired: {
      ...ociResourceManagerParams.isProviderUpgradeRequired,
      required: false,
    },
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
