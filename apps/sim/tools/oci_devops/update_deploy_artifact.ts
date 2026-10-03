import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsResponse,
  OciDevopsUpdateDeployArtifactParams,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateDeployArtifactTool: InternalToolConfig<
  OciDevopsUpdateDeployArtifactParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_deploy_artifact',
  name: 'OCI DevOps Update Deploy Artifact',
  description: 'Update Deploy Artifact in OCI DevOps',
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
    artifact: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed DeployArtifact configuration. Supports only documented fields; see the configuration example. Example: {}',
    },
    ifMatch: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'ETag from a preceding read. Mismatches fail without overwriting concurrent changes.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      deployArtifactId: params.deployArtifactId,
      artifact: params.artifact,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
