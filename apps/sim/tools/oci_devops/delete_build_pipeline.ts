import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsDeleteBuildPipelineParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsDeleteBuildPipelineTool: InternalToolConfig<
  OciDevopsDeleteBuildPipelineParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_delete_build_pipeline',
  name: 'OCI DevOps Delete Build Pipeline',
  description: 'Delete Build Pipeline in OCI DevOps',
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
      buildPipelineId: params.buildPipelineId,
      ifMatch: params.ifMatch,
    }),
  },
  outputs: ociDevopsOutputs,
}
