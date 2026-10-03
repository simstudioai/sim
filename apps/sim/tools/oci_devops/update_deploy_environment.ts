import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsResponse,
  OciDevopsUpdateDeployEnvironmentParams,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateDeployEnvironmentTool: InternalToolConfig<
  OciDevopsUpdateDeployEnvironmentParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_deploy_environment',
  name: 'OCI DevOps Update Deploy Environment',
  description: 'Update Deploy Environment in OCI DevOps',
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
    environment: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed DeployEnvironment configuration discriminated by deployEnvironmentType. Supports only documented fields; see the configuration example. Supported deployEnvironmentType values: COMPUTE_INSTANCE_GROUP, FUNCTION, OKE_CLUSTER. Example: {"deployEnvironmentType":"COMPUTE_INSTANCE_GROUP"}',
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
      deployEnvironmentId: params.deployEnvironmentId,
      environment: params.environment,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
