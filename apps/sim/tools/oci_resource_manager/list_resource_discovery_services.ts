import type {
  OciResourceManagerListResourceDiscoveryServicesParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, SERVICES_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListResourceDiscoveryServicesTool: InternalToolConfig<
  OciResourceManagerListResourceDiscoveryServicesParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_resource_discovery_services',
  name: 'OCI Resource Manager List Resource Discovery Services',
  description: 'List supported resource-discovery services and discovery scopes.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    services: {
      type: 'array',
      description: 'One page of services metadata with explicit optional projections',
      items: { type: 'object', properties: SERVICES_OUTPUTS },
    },
  },
}
