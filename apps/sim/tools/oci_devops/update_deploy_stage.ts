import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsResponse, OciDevopsUpdateDeployStageParams } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateDeployStageTool: InternalToolConfig<
  OciDevopsUpdateDeployStageParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_deploy_stage',
  name: 'OCI DevOps Update Deploy Stage',
  description: 'Update Deploy Stage in OCI DevOps',
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
    stage: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed DeployStage configuration discriminated by deployStageType. Supports only documented fields; see the configuration example. Supported deployStageType values: COMPUTE_INSTANCE_GROUP_BLUE_GREEN_DEPLOYMENT, COMPUTE_INSTANCE_GROUP_BLUE_GREEN_TRAFFIC_SHIFT, COMPUTE_INSTANCE_GROUP_CANARY_APPROVAL, COMPUTE_INSTANCE_GROUP_CANARY_DEPLOYMENT, COMPUTE_INSTANCE_GROUP_CANARY_TRAFFIC_SHIFT, COMPUTE_INSTANCE_GROUP_ROLLING_DEPLOYMENT, DEPLOY_FUNCTION, INVOKE_FUNCTION, LOAD_BALANCER_TRAFFIC_SHIFT, MANUAL_APPROVAL, OKE_BLUE_GREEN_DEPLOYMENT, OKE_BLUE_GREEN_TRAFFIC_SHIFT, OKE_CANARY_APPROVAL, OKE_CANARY_DEPLOYMENT, OKE_CANARY_TRAFFIC_SHIFT, OKE_DEPLOYMENT, OKE_HELM_CHART_DEPLOYMENT, SHELL, WAIT. Example: {"deployStageType":"COMPUTE_INSTANCE_GROUP_BLUE_GREEN_DEPLOYMENT"}',
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
      deployStageId: params.deployStageId,
      stage: params.stage,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
