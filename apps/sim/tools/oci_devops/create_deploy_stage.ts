import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsCreateDeployStageParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateDeployStageTool: InternalToolConfig<
  OciDevopsCreateDeployStageParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_deploy_stage',
  name: 'OCI DevOps Create Deploy Stage',
  description: 'Create Deploy Stage in OCI DevOps',
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
    stage: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed DeployStage configuration discriminated by deployStageType. Supports only documented fields; see the configuration example. Supported deployStageType values: COMPUTE_INSTANCE_GROUP_BLUE_GREEN_DEPLOYMENT, COMPUTE_INSTANCE_GROUP_BLUE_GREEN_TRAFFIC_SHIFT, COMPUTE_INSTANCE_GROUP_CANARY_APPROVAL, COMPUTE_INSTANCE_GROUP_CANARY_DEPLOYMENT, COMPUTE_INSTANCE_GROUP_CANARY_TRAFFIC_SHIFT, COMPUTE_INSTANCE_GROUP_ROLLING_DEPLOYMENT, DEPLOY_FUNCTION, INVOKE_FUNCTION, LOAD_BALANCER_TRAFFIC_SHIFT, MANUAL_APPROVAL, OKE_BLUE_GREEN_DEPLOYMENT, OKE_BLUE_GREEN_TRAFFIC_SHIFT, OKE_CANARY_APPROVAL, OKE_CANARY_DEPLOYMENT, OKE_CANARY_TRAFFIC_SHIFT, OKE_DEPLOYMENT, OKE_HELM_CHART_DEPLOYMENT, SHELL, WAIT. Example: {"deployStagePredecessorCollection":{"items":[{"id":"ocid1.resource.oc1..example"}]},"deployStageType":"COMPUTE_INSTANCE_GROUP_BLUE_GREEN_DEPLOYMENT","deployEnvironmentIdA":"example","deployEnvironmentIdB":"example","deploymentSpecDeployArtifactId":"ocid1.resource.oc1..example","productionLoadBalancerConfig":{"listenerName":"example","loadBalancerId":"ocid1.resource.oc1..example"},"rolloutPolicy":{"policyType":"COMPUTE_INSTANCE_GROUP_LINEAR_ROLLOUT_POLICY_BY_COUNT","batchCount":1}}',
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
      stage: params.stage,
      retryToken: params.retryToken,
    }),
  },
  outputs: ociDevopsOutputs,
}
