import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointListOutputs,
  sailpointPaginationParams,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointGetChildEntitlementsParams,
  SailPointListOutput,
  SailPointListResponse,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointGetAccountEntitlementsTool: ToolConfig<
  SailPointGetChildEntitlementsParams,
  SailPointListResponse
> = {
  id: 'sailpoint_get_account_entitlements',
  name: 'SailPoint Get Account Entitlements',
  description: 'List the entitlements granted on a specific SailPoint account.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account ID',
    },
    ...sailpointPaginationParams,
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_get_account_entitlements',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      id: params.id,
      limit: params.limit,
      offset: params.offset,
      count: params.count,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<SailPointListOutput>(response),

  outputs: sailpointListOutputs,
}
