import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointListOutputs,
  sailpointPaginationParams,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointListOutput,
  SailPointListResponse,
  SailPointListReviewItemsParams,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointListCertificationReviewItemsTool: ToolConfig<
  SailPointListReviewItemsParams,
  SailPointListResponse
> = {
  id: 'sailpoint_list_certification_review_items',
  name: 'SailPoint List Certification Review Items',
  description: 'List the access review items within a specific SailPoint certification.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Certification ID',
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
    entitlements: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter review items to specific entitlement IDs',
    },
    accessProfiles: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter review items to specific access profile IDs',
    },
    roles: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter review items to specific role IDs',
    },
    ...sailpointPaginationParams,
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_list_certification_review_items',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      id: params.id,
      filters: params.filters,
      sorters: params.sorters,
      entitlements: params.entitlements,
      accessProfiles: params.accessProfiles,
      roles: params.roles,
      limit: params.limit,
      offset: params.offset,
      count: params.count,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<SailPointListOutput>(response),

  outputs: sailpointListOutputs,
}
