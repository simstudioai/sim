import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsResponse, OciDevopsUpdateDeploymentParams } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateDeploymentTool: InternalToolConfig<
  OciDevopsUpdateDeploymentParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_deployment',
  name: 'OCI DevOps Update Deployment',
  description: 'Update Deployment in OCI DevOps',
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
    deployment: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed Deployment configuration discriminated by deploymentType. Supports only documented fields; see the configuration example. Supported deploymentType values: PIPELINE_DEPLOYMENT, PIPELINE_REDEPLOYMENT, SINGLE_STAGE_DEPLOYMENT, SINGLE_STAGE_REDEPLOYMENT. Example: {"deploymentType":"PIPELINE_DEPLOYMENT"}',
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
      deploymentId: params.deploymentId,
      deployment: params.deployment,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
