import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsListRefsParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsListRefsTool: InternalToolConfig<OciDevopsListRefsParams, OciDevopsResponse> =
  {
    id: 'oci_devops_list_refs',
    name: 'OCI DevOps List Refs',
    description: 'List Refs in OCI DevOps',
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
      refType: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Reference type to distinguish between branch and tag. If it is not specified, all references are returned. Allowed: BRANCH, TAG.',
      },
      commitId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Commit ID in a repository.',
      },
      limit: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'The maximum number of items to return.',
      },
      page: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'The page token representing the page at which to start retrieving results. This is usually retrieved from a previous list call.',
      },
      refName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'A filter to return only resources that match the given reference name.',
      },
      sortOrder: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'The sort order to use. Use either ascending or descending. Allowed: ASC, DESC.',
      },
      sortBy: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description:
          'The field to sort by. Only one sort order may be provided. Default order for reference name is ascending. Default order for reference type is ascending. If no value is specified reference name is default.\n Allowed: refType, refName.',
      },
    },
    operation: {
      input: (params) => ({
        oauthCredential: params.oauthCredential,
        region: params.region,
        repositoryId: params.repositoryId,
        refType: params.refType,
        commitId: params.commitId,
        limit: params.limit,
        page: params.page,
        refName: params.refName,
        sortOrder: params.sortOrder,
        sortBy: params.sortBy,
      }),
    },
    outputs: ociDevopsOutputs,
  }
