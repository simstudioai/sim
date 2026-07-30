import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointListOutputs,
  sailpointPaginationParams,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointAccessRequestStatusParams,
  SailPointListOutput,
  SailPointListResponse,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointGetAccessRequestStatusTool: ToolConfig<
  SailPointAccessRequestStatusParams,
  SailPointListResponse
> = {
  id: 'sailpoint_get_access_request_status',
  name: 'SailPoint Get Access Request Status',
  description:
    'List the status of SailPoint access requests with optional identity and state filters.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    requestedFor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identity ID the request was made for',
    },
    requestedBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identity ID that submitted the request',
    },
    regardingIdentity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identity ID the request is about (requester or target)',
    },
    assignedTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identity ID a pending approval is assigned to',
    },
    requestState: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'EXECUTING',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SailPoint filter expression to narrow results',
    },
    sorters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SailPoint sorters expression',
    },
    ...sailpointPaginationParams,
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_get_access_request_status',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      requestedFor: params.requestedFor,
      requestedBy: params.requestedBy,
      regardingIdentity: params.regardingIdentity,
      assignedTo: params.assignedTo,
      requestState: params.requestState,
      filters: params.filters,
      sorters: params.sorters,
      limit: params.limit,
      offset: params.offset,
      count: params.count,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<SailPointListOutput>(response),

  outputs: sailpointListOutputs,
}
