import type {
  OciResourceManagerListWorkRequestErrorsParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { ERROR_OUTPUTS, METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerListWorkRequestErrorsTool: InternalToolConfig<
  OciResourceManagerListWorkRequestErrorsParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_list_work_request_errors',
  name: 'OCI Resource Manager List Work Request Errors',
  description: 'List one page of work-request errors with explicit message disclosure.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    workRequestId: { ...ociResourceManagerParams.workRequestId, required: true },
    limit: { ...ociResourceManagerParams.limit, required: false },
    page: { ...ociResourceManagerParams.page, required: false },
    compartmentId: { ...ociResourceManagerParams.compartmentId, required: false },
    sortOrder: { ...ociResourceManagerParams.sortOrder, required: false },
    includeMessages: { ...ociResourceManagerParams.includeMessages, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    errors: {
      type: 'array',
      description: 'One page of errors metadata with explicit optional projections',
      items: { type: 'object', properties: ERROR_OUTPUTS },
    },
  },
}
