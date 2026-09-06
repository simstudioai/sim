import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetCommitParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetCommitTool: InternalToolConfig<
  OciDevopsGetCommitParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_commit',
  name: 'OCI DevOps Get Commit',
  description: 'Get Commit in OCI DevOps',
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
    repositoryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Unique repository identifier.',
    },
    commitId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'A filter to return only resources that match the given commit ID.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      repositoryId: params.repositoryId,
      commitId: params.commitId,
    }),
  },
  outputs: ociDevopsOutputs,
}
