import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsListRepositoriesParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsListRepositoriesTool: InternalToolConfig<
  OciDevopsListRepositoriesParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_list_repositories',
  name: 'OCI DevOps List Repositories',
  description: 'List Repositories in OCI DevOps',
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
    compartmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The OCID of the compartment in which to list resources.',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'unique project identifier',
    },
    repositoryId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique repository identifier.',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A filter to return only resources whose lifecycle state matches the given lifecycle state. Allowed: ACTIVE, CREATING, DELETED, FAILED, DELETING.',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return only resources that match the entire name given.',
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
        'The field to sort by. Only one sort order may be provided. Default order for time created is descending. Default order for name is ascending. If no value is specified time created is default.\n Allowed: timeCreated, name.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      compartmentId: params.compartmentId,
      projectId: params.projectId,
      repositoryId: params.repositoryId,
      lifecycleState: params.lifecycleState,
      name: params.name,
      limit: params.limit,
      page: params.page,
      sortOrder: params.sortOrder,
      sortBy: params.sortBy,
    }),
  },
  outputs: ociDevopsOutputs,
}
