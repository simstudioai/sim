import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsCreateDeployEnvironmentParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateDeployEnvironmentTool: InternalToolConfig<
  OciDevopsCreateDeployEnvironmentParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_deploy_environment',
  name: 'OCI DevOps Create Deploy Environment',
  description: 'Create Deploy Environment in OCI DevOps',
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
    environment: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed DeployEnvironment configuration discriminated by deployEnvironmentType. Supports only documented fields; see the configuration example. Supported deployEnvironmentType values: COMPUTE_INSTANCE_GROUP, FUNCTION, OKE_CLUSTER. Example: {"deployEnvironmentType":"COMPUTE_INSTANCE_GROUP","computeInstanceGroupSelectors":{"items":[{"selectorType":"INSTANCE_IDS","computeInstanceIds":["example"]}]}}',
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
      environment: params.environment,
      retryToken: params.retryToken,
    }),
  },
  outputs: ociDevopsOutputs,
}
