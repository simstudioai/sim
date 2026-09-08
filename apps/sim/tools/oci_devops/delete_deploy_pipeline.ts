import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsDeleteDeployPipelineParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsDeleteDeployPipelineTool: InternalToolConfig<
  OciDevopsDeleteDeployPipelineParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_delete_deploy_pipeline',
  name: 'OCI DevOps Delete Deploy Pipeline',
  description: 'Delete Deploy Pipeline in OCI DevOps',
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
      description: 'Unique pipeline identifier.',
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
      deployPipelineId: params.deployPipelineId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
