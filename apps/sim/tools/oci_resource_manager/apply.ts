import type {
  OciResourceManagerApplyParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { JOB_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerApplyTool: InternalToolConfig<
  OciResourceManagerApplyParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_apply',
  name: 'OCI Resource Manager Apply',
  description: 'Submit a confirmed apply using an explicit plan or explicit auto-approval.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    stackId: { ...ociResourceManagerParams.stackId, required: true },
    executionPlanStrategy: { ...ociResourceManagerParams.executionPlanStrategy, required: true },
    confirmApply: { ...ociResourceManagerParams.confirmApply, required: true },
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
    executionPlanJobId: { ...ociResourceManagerParams.executionPlanJobId, required: false },
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
