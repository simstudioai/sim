import type {
  OciResourceManagerListAssociatedResourcesParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, RESOURCES_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListAssociatedResourcesTool: InternalToolConfig<
  OciResourceManagerListAssociatedResourcesParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_associated_resources',
  name: 'OCI Resource Manager List Associated Resources',
  description: 'List resources associated with a stack or job, optionally including attributes.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    scope: { ...ociResourceManagerParams.scope, required: true },
    stackId: { ...ociResourceManagerParams.stackId, required: false },
    jobId: { ...ociResourceManagerParams.jobId, required: false },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: false },
    terraformResourceType: { ...ociResourceManagerParams.terraformResourceType, required: false },
    limit: { ...ociResourceManagerParams.limit, required: false },
    page: { ...ociResourceManagerParams.page, required: false },
    includeAttributes: { ...ociResourceManagerParams.includeAttributes, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    resources: {
      type: 'array',
      description: 'One page of resources metadata with explicit optional projections',
      items: { type: 'object', properties: RESOURCES_OUTPUTS },
    },
  },
}
