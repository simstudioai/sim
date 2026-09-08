import type {
  OciResourceManagerListTemplatesParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, TEMPLATES_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListTemplatesTool: InternalToolConfig<
  OciResourceManagerListTemplatesParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_templates',
  name: 'OCI Resource Manager List Templates',
  description: 'List available Resource Manager templates.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    limit: { ...ociResourceManagerParams.limit, required: false },
    page: { ...ociResourceManagerParams.page, required: false },
    sortBy: { ...ociResourceManagerParams.sortBy, required: false },
    sortOrder: { ...ociResourceManagerParams.sortOrder, required: false },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: false },
    displayName: { ...ociResourceManagerParams.displayName, required: false },
    templateCategoryId: { ...ociResourceManagerParams.templateCategoryId, required: false },
    templateId: { ...ociResourceManagerParams.templateId, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    templates: {
      type: 'array',
      description: 'One page of templates metadata with explicit optional projections',
      items: { type: 'object', properties: TEMPLATES_OUTPUTS },
    },
  },
}
