import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsDeleteBuildPipelineStageParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsDeleteBuildPipelineStageTool: InternalToolConfig<
  OciDevopsDeleteBuildPipelineStageParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_delete_build_pipeline_stage',
  name: 'OCI DevOps Delete Build Pipeline Stage',
  description: 'Delete Build Pipeline Stage in OCI DevOps',
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
      buildPipelineStageId: params.buildPipelineStageId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
