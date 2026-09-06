import type {
  OciResourceManagerDownloadJobLogsParams,
  OciResourceManagerResponse,
} from '@/tools/oci_resource_manager/types'
import { METADATA_OUTPUTS } from '@/tools/oci_resource_manager/types'
import { ociResourceManagerParams } from '@/tools/oci_resource_manager/utils'
import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { InternalToolConfig } from '@/tools/types'

export const ociResourceManagerDownloadJobLogsTool: InternalToolConfig<
  OciResourceManagerDownloadJobLogsParams,
  OciResourceManagerResponse
> = {
  id: 'oci_resource_manager_download_job_logs',
  name: 'OCI Resource Manager Download Job Logs',
  description: 'Download console or detailed job logs into an authorized stored file.',
  version: '1.0.0',
  oauth: { required: true, provider: 'oci-resource-manager', credentialKind: 'service-account' },
  params: {
    oauthCredential: { ...ociResourceManagerParams.oauthCredential, required: true },
    region: { ...ociResourceManagerParams.region, required: false },
    jobId: { ...ociResourceManagerParams.jobId, required: true },
    kind: { ...ociResourceManagerParams.kind, required: true },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    ...METADATA_OUTPUTS,
    file: { type: 'file', description: 'Stored file reference; contents may contain secrets' },
  },
}
