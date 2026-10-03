import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetDeployArtifactParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetDeployArtifactTool: InternalToolConfig<
  OciDevopsGetDeployArtifactParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_deploy_artifact',
  name: 'OCI DevOps Get Deploy Artifact',
  description: 'Get Deploy Artifact in OCI DevOps',
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
    deployArtifactId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique artifact identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      deployArtifactId: params.deployArtifactId,
    }),
  },
  outputs: ociDevopsOutputs,
}
