import type {
  OciResourceManagerCreateStackParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, STACK_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerCreateStackTool: InternalToolConfig<
  OciResourceManagerCreateStackParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_create_stack',
  name: 'OCI Resource Manager Create Stack',
  description: 'Create a stack from an existing configuration source without applying it.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: true },
    configSource: { ...ociResourceManagerParams.configSource, required: true },
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
    file: { ...ociResourceManagerParams.file, required: false },
    retryToken: { ...ociResourceManagerParams.retryToken, required: false },
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
