import type {
  OciResourceManagerListTerraformVersionsParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, VERSIONS_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListTerraformVersionsTool: InternalToolConfig<
  OciResourceManagerListTerraformVersionsParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_terraform_versions',
  name: 'OCI Resource Manager List Terraform Versions',
  description: 'List supported Terraform versions and the default version.',
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
    versions: {
      type: 'array',
      description: 'One page of versions metadata with explicit optional projections',
      items: { type: 'object', properties: VERSIONS_OUTPUTS },
    },
  },
}
