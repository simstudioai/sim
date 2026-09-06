import type {
  OciResourceManagerListConfigurationSourceProvidersParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, PROVIDERS_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListConfigurationSourceProvidersTool: InternalToolConfig<
  OciResourceManagerListConfigurationSourceProvidersParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_configuration_source_providers',
  name: 'OCI Resource Manager List Configuration Source Providers',
  description: 'List existing configuration source providers without exposing credentials.',
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
    configurationSourceProviderId: {
      ...ociResourceManagerParams.configurationSourceProviderId,
      required: false,
    },
    configSourceProviderType: {
      ...ociResourceManagerParams.configSourceProviderType,
      required: false,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    providers: {
      type: 'array',
      description: 'One page of providers metadata with explicit optional projections',
      items: { type: 'object', properties: PROVIDERS_OUTPUTS },
    },
  },
}
