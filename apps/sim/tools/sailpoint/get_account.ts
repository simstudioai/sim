import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointItemOutputs,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type { SailPointGetByIdParams, SailPointItemResponse } from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointGetAccountTool: ToolConfig<SailPointGetByIdParams, SailPointItemResponse> = {
  id: 'sailpoint_get_account',
  name: 'SailPoint Get Account',
  description: 'Get a single SailPoint account by ID.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Account ID',
    },
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_get_account',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      id: params.id,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<{ item: unknown }>(response),

  outputs: sailpointItemOutputs,
}
