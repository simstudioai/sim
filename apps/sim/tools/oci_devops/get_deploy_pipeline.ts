import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetDeployPipelineParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetDeployPipelineTool: InternalToolConfig<
  OciDevopsGetDeployPipelineParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_deploy_pipeline',
  name: 'OCI DevOps Get Deploy Pipeline',
  description: 'Get Deploy Pipeline in OCI DevOps',
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
    deployPipelineId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique pipeline identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      deployPipelineId: params.deployPipelineId,
    }),
  },
  outputs: ociDevopsOutputs,
}
