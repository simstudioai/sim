import type {
  OciResourceManagerResponse,
  OciResourceManagerUpdateStackParams,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, STACK_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerUpdateStackTool: InternalToolConfig<
  OciResourceManagerUpdateStackParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_update_stack',
  name: 'OCI Resource Manager Update Stack',
  description: 'Update stack configuration, variables, or metadata without submitting a job.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    stackId: { ...ociResourceManagerParams.stackId, required: true },
    displayName: { ...ociResourceManagerParams.displayName, required: false },
    description: { ...ociResourceManagerParams.description, required: false },
    variables: { ...ociResourceManagerParams.variables, required: false },
    terraformVersion: { ...ociResourceManagerParams.terraformVersion, required: false },
    customTerraformProvider: {
      ...ociResourceManagerParams.customTerraformProvider,
      required: false,
    },
    freeformTags: { ...ociResourceManagerParams.freeformTags, required: false },
    definedTags: { ...ociResourceManagerParams.definedTags, required: false },
    configSource: { ...ociResourceManagerParams.configSource, required: false },
    file: { ...ociResourceManagerParams.file, required: false },
    ifMatch: { ...ociResourceManagerParams.ifMatch, required: false },
    isThirdPartyProviderExperienceEnabled: {
      ...ociResourceManagerParams.isThirdPartyProviderExperienceEnabled,
      required: false,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    stack: {
      type: 'object',
      description: 'stack metadata with explicit optional projections',
      properties: STACK_OUTPUTS,
    },
  },
}
