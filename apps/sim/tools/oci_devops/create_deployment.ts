import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsCreateDeploymentParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateDeploymentTool: InternalToolConfig<
  OciDevopsCreateDeploymentParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_deployment',
  name: 'OCI DevOps Create Deployment',
  description: 'Create Deployment in OCI DevOps',
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
      description: 'The OCID of a pipeline.',
    },
    deployment: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed Deployment configuration discriminated by deploymentType. Supports only documented fields; see the configuration example. Supported deploymentType values: PIPELINE_DEPLOYMENT, PIPELINE_REDEPLOYMENT, SINGLE_STAGE_DEPLOYMENT, SINGLE_STAGE_REDEPLOYMENT. Example: {"deploymentType":"PIPELINE_DEPLOYMENT"}',
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
      deployPipelineId: params.deployPipelineId,
      deployment: params.deployment,
      retryToken: params.retryToken,
    }),
  },
  outputs: ociDevopsOutputs,
}
