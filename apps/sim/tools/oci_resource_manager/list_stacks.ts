import type {
  OciResourceManagerListStacksParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, STACK_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListStacksTool: InternalToolConfig<
  OciResourceManagerListStacksParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_stacks',
  name: 'OCI Resource Manager List Stacks',
  description: 'List one page of stacks in a compartment.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: true },
    limit: { ...ociResourceManagerParams.limit, required: false },
    page: { ...ociResourceManagerParams.page, required: false },
    sortBy: { ...ociResourceManagerParams.sortBy, required: false },
    sortOrder: { ...ociResourceManagerParams.sortOrder, required: false },
    displayName: { ...ociResourceManagerParams.displayName, required: false },
    id: { ...ociResourceManagerParams.id, required: false },
    lifecycleState: { ...ociResourceManagerParams.lifecycleState, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    stacks: {
      type: 'array',
      description: 'One page of stacks metadata with explicit optional projections',
      items: { type: 'object', properties: STACK_OUTPUTS },
    },
  },
}
