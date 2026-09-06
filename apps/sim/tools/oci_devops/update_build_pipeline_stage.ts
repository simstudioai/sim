import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsResponse,
  OciDevopsUpdateBuildPipelineStageParams,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsUpdateBuildPipelineStageTool: InternalToolConfig<
  OciDevopsUpdateBuildPipelineStageParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_update_build_pipeline_stage',
  name: 'OCI DevOps Update Build Pipeline Stage',
  description: 'Update Build Pipeline Stage in OCI DevOps',
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
    stage: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed BuildPipelineStage configuration discriminated by buildPipelineStageType. Supports only documented fields; see the configuration example. Supported buildPipelineStageType values: BUILD, DELIVER_ARTIFACT, TRIGGER_DEPLOYMENT_PIPELINE, WAIT. Example: {"buildPipelineStageType":"BUILD"}',
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
      stage: params.stage,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
