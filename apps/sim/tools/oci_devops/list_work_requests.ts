import { ociDevopsOutputs } from '@/tools/oci_devops/outputs'
import type { OciDevopsListWorkRequestsParams, OciDevopsResponse } from '@/tools/oci_devops/types'
import type { InternalToolConfig } from '@/tools/types'

export const ociDevopsListWorkRequestsTool: InternalToolConfig<
  OciDevopsListWorkRequestsParams,
  OciDevopsResponse
> = {
  id: 'oci_devops_list_work_requests',
  name: 'OCI DevOps List Work Requests',
  description: 'List Work Requests in OCI DevOps',
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
      required: true,
      visibility: 'user-or-llm',
      description: 'The OCID of the compartment in which to list resources.',
    },
    workRequestId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the asynchronous work request.',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A filter to return only resources where the lifecycle state matches the given operation status. Allowed: ACCEPTED, IN_PROGRESS, FAILED, SUCCEEDED, CANCELING, CANCELED, WAITING, NEEDS_ATTENTION.',
    },
    resourceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The ID of the resource affected by the work request.',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'The page token representing the page at which to start retrieving results. This is usually retrieved from a previous list call.',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'The maximum number of items to return.',
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
        'The field to sort by. Only one sort order can be provided. Default sort order is descending and is based on the timeAccepted field. Allowed: timeAccepted.',
    },
    operationTypeMultiValueQuery: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'A filter to return only resources where their Operation Types matches the parameter operation types',
    },
  },
  operation: {
    input: (params) => ({
      oauthCredential: params.oauthCredential,
      region: params.region,
      compartmentId: params.compartmentId,
      workRequestId: params.workRequestId,
      status: params.status,
      resourceId: params.resourceId,
      page: params.page,
      limit: params.limit,
      sortOrder: params.sortOrder,
      sortBy: params.sortBy,
      operationTypeMultiValueQuery: params.operationTypeMultiValueQuery,
    }),
  },
  outputs: ociDevopsOutputs,
}
