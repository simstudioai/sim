import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsGetDeployEnvironmentParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetDeployEnvironmentTool: InternalToolConfig<
  OciDevopsGetDeployEnvironmentParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_deploy_environment',
  name: 'OCI DevOps Get Deploy Environment',
  description: 'Get Deploy Environment in OCI DevOps',
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
    deployEnvironmentId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique environment identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      deployEnvironmentId: params.deployEnvironmentId,
    }),
  },
  outputs: ociDevopsOutputs,
}
