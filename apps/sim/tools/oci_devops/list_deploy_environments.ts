import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type {
  OciDevopsListDeployEnvironmentsParams,
  OciDevopsResponse,
} from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsListDeployEnvironmentsTool: InternalToolConfig<
  OciDevopsListDeployEnvironmentsParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_list_deploy_environments',
  name: 'OCI DevOps List Deploy Environments',
  description: 'List Deploy Environments in OCI DevOps',
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
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique identifier or OCID for listing a single resource by ID.',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A filter to return only DeployEnvironments that matches the given lifecycleState. Allowed: CREATING, UPDATING, ACTIVE, DELETING, DELETED, FAILED, NEEDS_ATTENTION.',
    },
    displayName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'A filter to return only resources that match the entire display name given.',
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
      projectId: params.projectId,
      compartmentId: params.compartmentId,
      id: params.id,
      lifecycleState: params.lifecycleState,
      displayName: params.displayName,
      limit: params.limit,
      page: params.page,
      sortOrder: params.sortOrder,
      sortBy: params.sortBy,
    }),
  },
  outputs: ociDevopsOutputs,
}
