import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetDeploymentParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetDeploymentTool: InternalToolConfig<
  OciDevopsGetDeploymentParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_deployment',
  name: 'OCI DevOps Get Deployment',
  description: 'Get Deployment in OCI DevOps',
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
    deploymentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique deployment identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      deploymentId: params.deploymentId,
    }),
  },
  outputs: ociDevopsOutputs,
}
