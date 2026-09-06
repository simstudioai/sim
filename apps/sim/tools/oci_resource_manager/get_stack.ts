import type {
  OciResourceManagerGetStackParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, STACK_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerGetStackTool: InternalToolConfig<
  OciResourceManagerGetStackParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_get_stack',
  name: 'OCI Resource Manager Get Stack',
  description: 'Inspect stack metadata with deliberate variable and source projections.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    stackId: { ...ociResourceManagerParams.stackId, required: true },
    includeVariables: { ...ociResourceManagerParams.includeVariables, required: false },
    variableNames: { ...ociResourceManagerParams.variableNames, required: false },
    includeSource: { ...ociResourceManagerParams.includeSource, required: false },
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
