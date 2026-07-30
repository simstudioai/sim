import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointListOutputs,
  sailpointPaginationParams,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointListCampaignsParams,
  SailPointListOutput,
  SailPointListResponse,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointListCampaignsTool: ToolConfig<
  SailPointListCampaignsParams,
  SailPointListResponse
> = {
  id: 'sailpoint_list_campaigns',
  name: 'SailPoint List Campaigns',
  description:
    'List certification campaigns in SailPoint with optional filters, sorters, and pagination.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    detail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SLIM (default) or FULL',
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
      operation: 'sailpoint_list_campaigns',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      detail: params.detail,
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
