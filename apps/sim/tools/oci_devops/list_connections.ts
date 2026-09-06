import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsListConnectionsParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsListConnectionsTool: InternalToolConfig<
  OciDevopsListConnectionsParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_list_connections',
  name: 'OCI DevOps List Connections',
  description: 'List Connections in OCI DevOps',
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
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique identifier or OCID for listing a single resource by ID.',
    },
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'unique project identifier',
    },
    compartmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The OCID of the compartment in which to list resources.',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A filter to return only connections that matches the given lifecycle state. Allowed: ACTIVE, DELETING.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return only resources that match the entire display name given.',
    },
    connectionType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A filter to return only resources that match the given connection type. Allowed: GITHUB_ACCESS_TOKEN, GITLAB_ACCESS_TOKEN, GITLAB_SERVER_ACCESS_TOKEN, BITBUCKET_SERVER_ACCESS_TOKEN, BITBUCKET_CLOUD_APP_PASSWORD, VBS_ACCESS_TOKEN.',
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
        'The field to sort by. Only one sort order may be provided. Default order for time created is descending. Default order for display name is ascending. If no value is specified, then the default time created value is considered. Allowed: timeCreated, displayName.',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      id: params.id,
      projectId: params.projectId,
      compartmentId: params.compartmentId,
      lifecycleState: params.lifecycleState,
      displayName: params.displayName,
      connectionType: params.connectionType,
      limit: params.limit,
      page: params.page,
      sortOrder: params.sortOrder,
      sortBy: params.sortBy,
    }),
  },
  outputs: ociDevopsOutputs,
}
