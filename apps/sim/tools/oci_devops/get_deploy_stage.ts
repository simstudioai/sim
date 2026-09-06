import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetDeployStageParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetDeployStageTool: InternalToolConfig<
  OciDevopsGetDeployStageParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_deploy_stage',
  name: 'OCI DevOps Get Deploy Stage',
  description: 'Get Deploy Stage in OCI DevOps',
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
    deployStageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique stage identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      deployStageId: params.deployStageId,
    }),
  },
  outputs: ociDevopsOutputs,
}
