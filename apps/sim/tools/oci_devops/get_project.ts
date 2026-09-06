import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetProjectParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetProjectTool: InternalToolConfig<
  OciDevopsGetProjectParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_project',
  name: 'OCI DevOps Get Project',
  description: 'Get Project in OCI DevOps',
  version: '1.0.0',
  params: {
    oauthCredential: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OCI API-key service-account credential ID',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OCI region; defaults to the credential region',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique project identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      projectId: params.projectId,
    }),
  },
  outputs: ociDevopsOutputs,
}
