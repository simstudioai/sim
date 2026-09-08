import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsListDeploymentsParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsListDeploymentsTool: InternalToolConfig<
  OciDevopsListDeploymentsParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_list_deployments',
  name: 'OCI DevOps List Deployments',
  description: 'List Deployments in OCI DevOps',
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
    deployPipelineId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the parent pipeline.',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique identifier or OCID for listing a single resource by ID.',
    },
    compartmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The OCID of the compartment in which to list resources.',
    },
    projectId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'unique project identifier',
    },
    lifecycleState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A filter to return only Deployments that matches the given lifecycleState. Allowed: ACCEPTED, IN_PROGRESS, FAILED, SUCCEEDED, CANCELING, CANCELED.',
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
    timeCreatedLessThan: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search for DevOps resources that were created before a specific date. Specifying this parameter corresponding to `timeCreatedLessThan` parameter will retrieve all assessments created before the specified created date, in "YYYY-MM-ddThh:mmZ" format with a Z offset, as defined by [RFC3339](https://datatracker.ietf.org/doc/html/rfc3339).',
    },
    timeCreatedGreaterThanOrEqualTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Search for DevOps resources that were created after a specific date. Specifying this parameter corresponding to `timeCreatedGreaterThanOrEqualTo` parameter will retrieve all security assessments created after the specified created date, in "YYYY-MM-ddThh:mmZ" format with a Z offset, as defined by [RFC3339](https://datatracker.ietf.org/doc/html/rfc3339).',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      deployPipelineId: params.deployPipelineId,
      id: params.id,
      compartmentId: params.compartmentId,
      projectId: params.projectId,
      lifecycleState: params.lifecycleState,
      displayName: params.displayName,
      limit: params.limit,
      page: params.page,
      sortOrder: params.sortOrder,
      sortBy: params.sortBy,
      timeCreatedLessThan: params.timeCreatedLessThan,
      timeCreatedGreaterThanOrEqualTo: params.timeCreatedGreaterThanOrEqualTo,
    }),
  },
  outputs: ociDevopsOutputs,
}
