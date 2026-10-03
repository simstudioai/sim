import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetBuildPipelineParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetBuildPipelineTool: InternalToolConfig<
  OciDevopsGetBuildPipelineParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_build_pipeline',
  name: 'OCI DevOps Get Build Pipeline',
  description: 'Get Build Pipeline in OCI DevOps',
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
      description: 'Unique build pipeline identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      buildPipelineId: params.buildPipelineId,
    }),
  },
  outputs: ociDevopsOutputs,
}
