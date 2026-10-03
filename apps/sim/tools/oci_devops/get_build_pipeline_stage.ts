import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsGetBuildPipelineStageParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetBuildPipelineStageTool: InternalToolConfig<
  OciDevopsGetBuildPipelineStageParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_build_pipeline_stage',
  name: 'OCI DevOps Get Build Pipeline Stage',
  description: 'Get Build Pipeline Stage in OCI DevOps',
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
    buildPipelineStageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique stage identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      buildPipelineStageId: params.buildPipelineStageId,
    }),
  },
  outputs: ociDevopsOutputs,
}
