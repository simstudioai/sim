import type {
  OciResourceManagerPlanParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { JOB_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerPlanTool: InternalToolConfig<
  OciResourceManagerPlanParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_plan',
  name: 'OCI Resource Manager Plan',
  description: 'Submit an Oracle-managed Terraform plan and return the job status.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    stackId: { ...ociResourceManagerParams.stackId, required: true },
    displayName: { ...ociResourceManagerParams.displayName, required: false },
    freeformTags: { ...ociResourceManagerParams.freeformTags, required: false },
    definedTags: { ...ociResourceManagerParams.definedTags, required: false },
    retryToken: { ...ociResourceManagerParams.retryToken, required: false },
    isProviderUpgradeRequired: {
      ...ociResourceManagerParams.isProviderUpgradeRequired,
      required: false,
    },
    terraformAdvancedOptions: {
      ...ociResourceManagerParams.terraformAdvancedOptions,
      required: false,
    },
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
