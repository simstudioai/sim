import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsCreateBuildPipelineStageParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsCreateBuildPipelineStageTool: InternalToolConfig<
  OciDevopsCreateBuildPipelineStageParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_create_build_pipeline_stage',
  name: 'OCI DevOps Create Build Pipeline Stage',
  description: 'Create Build Pipeline Stage in OCI DevOps',
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
    buildPipelineId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The OCID of the build pipeline.',
    },
    stage: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Typed BuildPipelineStage configuration discriminated by buildPipelineStageType. Supports only documented fields; see the configuration example. Supported buildPipelineStageType values: BUILD, DELIVER_ARTIFACT, TRIGGER_DEPLOYMENT_PIPELINE, WAIT. Example: {"buildPipelineStagePredecessorCollection":{"items":[{"id":"ocid1.resource.oc1..example"}]},"buildPipelineStageType":"BUILD","buildSourceCollection":{"items":[{"branch":"example","connectionType":"BITBUCKET_CLOUD","name":"example","repositoryUrl":"https://example.com/repository","connectionId":"ocid1.resource.oc1..example"}]},"image":"OL7_X86_64_STANDARD_10"}',
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
      buildPipelineId: params.buildPipelineId,
      stage: params.stage,
      retryToken: params.retryToken,
    }),
  },
  outputs: ociDevopsOutputs,
}
