import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointListOutputs,
  sailpointPaginationParams,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointListEntitlementsParams,
  SailPointListOutput,
  SailPointListResponse,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointListEntitlementsTool: ToolConfig<
  SailPointListEntitlementsParams,
  SailPointListResponse
> = {
  id: 'sailpoint_list_entitlements',
  name: 'SailPoint List Entitlements',
  description: 'List entitlements in SailPoint with optional filters, sorters, and pagination.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
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
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter to entitlements on a specific account ID',
    },
    segmentedForIdentity: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only entitlements visible to the given identity via segmentation',
    },
    ...sailpointPaginationParams,
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_list_entitlements',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      filters: params.filters,
      sorters: params.sorters,
      accountId: params.accountId,
      segmentedForIdentity: params.segmentedForIdentity,
      limit: params.limit,
      offset: params.offset,
      count: params.count,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<SailPointListOutput>(response),

  outputs: sailpointListOutputs,
}
