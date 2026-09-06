import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsCreateDeployArtifactParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateDeployArtifactTool: InternalToolConfig<
  OciDevopsCreateDeployArtifactParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_deploy_artifact',
  name: 'OCI DevOps Create Deploy Artifact',
  description: 'Create Deploy Artifact in OCI DevOps',
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
      description: 'The OCID of a project.',
    },
    artifact: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed DeployArtifact configuration. Supports only documented fields; see the configuration example. Example: {"argumentSubstitutionMode":"NONE","deployArtifactSource":{"deployArtifactSourceType":"GENERIC_ARTIFACT","deployArtifactPath":"example","deployArtifactVersion":"example","repositoryId":"ocid1.resource.oc1..example"},"deployArtifactType":"DEPLOYMENT_SPEC"}',
    },
    retryToken: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Stable idempotency token (1–64 ASCII characters). Reuse for retries of this action; use a new token for a new action.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      projectId: params.projectId,
      artifact: params.artifact,
      retryToken: params.retryToken,
    }),
  },
  outputs: ociDevopsOutputs,
}
