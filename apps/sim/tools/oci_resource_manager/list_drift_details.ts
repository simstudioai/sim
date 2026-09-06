import type {
  OciResourceManagerListDriftDetailsParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { DRIFTDETAILS_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListDriftDetailsTool: InternalToolConfig<
  OciResourceManagerListDriftDetailsParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_drift_details',
  name: 'OCI Resource Manager List Drift Details',
  description: 'Read drift results for a selected or latest completed detection work request.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    stackId: { ...ociResourceManagerParams.stackId, required: true },
    limit: { ...ociResourceManagerParams.limit, required: false },
    page: { ...ociResourceManagerParams.page, required: false },
    workRequestId: { ...ociResourceManagerParams.workRequestId, required: false },
    resourceDriftStatus: { ...ociResourceManagerParams.resourceDriftStatus, required: false },
    includeProperties: { ...ociResourceManagerParams.includeProperties, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    driftDetails: {
      type: 'array',
      description: 'One page of driftDetails metadata with explicit optional projections',
      items: { type: 'object', properties: DRIFTDETAILS_OUTPUTS },
    },
  },
}
