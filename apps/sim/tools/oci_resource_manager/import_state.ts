import type {
  OciResourceManagerImportStateParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { JOB_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerImportStateTool: InternalToolConfig<
  OciResourceManagerImportStateParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_import_state',
  name: 'OCI Resource Manager Import State',
  description: 'Import an authorized Terraform state file through an Oracle-managed job.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    stackId: { ...ociResourceManagerParams.stackId, required: true },
    file: { ...ociResourceManagerParams.file, required: true },
    confirmStateReplacement: {
      ...ociResourceManagerParams.confirmStateReplacement,
      required: true,
    },
    displayName: { ...ociResourceManagerParams.displayName, required: false },
    freeformTags: { ...ociResourceManagerParams.freeformTags, required: false },
    definedTags: { ...ociResourceManagerParams.definedTags, required: false },
    retryToken: { ...ociResourceManagerParams.retryToken, required: false },
    isProviderUpgradeRequired: {
      ...ociResourceManagerParams.isProviderUpgradeRequired,
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
