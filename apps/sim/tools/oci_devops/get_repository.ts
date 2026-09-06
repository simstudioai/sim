import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsGetRepositoryParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsGetRepositoryTool: InternalToolConfig<
  OciDevopsGetRepositoryParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_get_repository',
  name: 'OCI DevOps Get Repository',
  description: 'Get Repository in OCI DevOps',
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
    fields: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Fields parameter can contain multiple flags useful in deciding the API functionality.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      repositoryId: params.repositoryId,
      fields: params.fields,
    }),
  },
  outputs: ociDevopsOutputs,
}
