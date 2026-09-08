import type {
  OciResourceManagerGetWorkRequestParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS, WORKREQUEST_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerGetWorkRequestTool: InternalToolConfig<
  OciResourceManagerGetWorkRequestParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_get_work_request',
  name: 'OCI Resource Manager Get Work Request',
  description: 'Inspect asynchronous Resource Manager work-request progress.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    workRequestId: { ...ociResourceManagerParams.workRequestId, required: true },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    workRequest: {
      type: 'object',
      description: 'workRequest metadata with explicit optional projections',
      properties: WORKREQUEST_OUTPUTS,
    },
  },
}
