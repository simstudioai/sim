import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointListOutputs,
  sailpointPaginationParams,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointListAccountActivitiesParams,
  SailPointListOutput,
  SailPointListResponse,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointListAccountActivitiesTool: ToolConfig<
  SailPointListAccountActivitiesParams,
  SailPointListResponse
> = {
  id: 'sailpoint_list_account_activities',
  name: 'SailPoint List Account Activities',
  description:
    'List account activities (provisioning events) in SailPoint with optional filters and pagination.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    requestedFor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identity ID the activity was requested for',
    },
    requestedBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identity ID that requested the activity',
    },
    regardingIdentity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Identity ID the activity is about (requester or target)',
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
      operation: 'sailpoint_list_account_activities',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      requestedFor: params.requestedFor,
      requestedBy: params.requestedBy,
      regardingIdentity: params.regardingIdentity,
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
