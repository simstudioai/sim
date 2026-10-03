import type {
  OciResourceManagerListWorkRequestsParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, WORKREQUEST_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListWorkRequestsTool: InternalToolConfig<
  OciResourceManagerListWorkRequestsParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_work_requests',
  name: 'OCI Resource Manager List Work Requests',
  description: 'List one page of Resource Manager work requests.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: true },
    limit: { ...ociResourceManagerParams.limit, required: false },
    page: { ...ociResourceManagerParams.page, required: false },
    resourceId: { ...ociResourceManagerParams.resourceId, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    workRequests: {
      type: 'array',
      description: 'One page of workRequests metadata with explicit optional projections',
      items: { type: 'object', properties: WORKREQUEST_OUTPUTS },
    },
  },
}
