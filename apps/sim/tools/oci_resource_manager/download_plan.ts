import type {
  OciResourceManagerDownloadPlanParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerDownloadPlanTool: InternalToolConfig<
  OciResourceManagerDownloadPlanParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_download_plan',
  name: 'OCI Resource Manager Download Plan',
  description: 'Download a Terraform plan in binary or JSON format as a stored file.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    jobId: { ...ociResourceManagerParams.jobId, required: true },
    tfPlanFormat: { ...ociResourceManagerParams.tfPlanFormat, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    file: { type: 'file', description: 'Stored file reference; contents may contain secrets' },
  },
}
