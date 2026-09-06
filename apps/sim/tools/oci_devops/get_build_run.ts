import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetBuildRunParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetBuildRunTool: InternalToolConfig<
  OciDevopsGetBuildRunParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_build_run',
  name: 'OCI DevOps Get Build Run',
  description: 'Get Build Run in OCI DevOps',
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
    buildRunId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique build run identifier.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      buildRunId: params.buildRunId,
    }),
  },
  outputs: ociDevopsOutputs,
}
