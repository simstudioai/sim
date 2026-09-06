import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsListPathsParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsListPathsTool: InternalToolConfig<
  OciDevopsListPathsParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_list_paths',
  name: 'OCI DevOps List Paths',
  description: 'List Paths in OCI DevOps',
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
    ref: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The name of branch/tag or commit hash it points to. If names conflict, order of preference is commit > branch > tag.\nYou can disambiguate with "heads/foobar" and "tags/foobar". If left blank repository\'s default branch will be used.\n',
    },
    pathsInSubtree: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Flag to determine if files must be retrived recursively. Flag is False by default.',
    },
    folderPath: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The fully qualified path to the folder whose contents are returned, including the folder name. For example, /examples is a fully-qualified path to a folder named examples that was created off of the root directory (/) of a repository.',
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
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return only resources that match the entire display name given.',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The sort order to use. Use either ascending or descending. Allowed: ASC, DESC.',
    },
    sortBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The field to sort by. Only one sort order may be provided. Default order is ascending. If no value is specified name is default.\n Allowed: type, sizeInBytes, name.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      repositoryId: params.repositoryId,
      ref: params.ref,
      pathsInSubtree: params.pathsInSubtree,
      folderPath: params.folderPath,
      limit: params.limit,
      page: params.page,
      displayName: params.displayName,
      sortOrder: params.sortOrder,
      sortBy: params.sortBy,
    }),
  },
  outputs: ociDevopsOutputs,
}
