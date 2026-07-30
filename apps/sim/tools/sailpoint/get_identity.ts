import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointItemOutputs,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type { SailPointGetByIdParams, SailPointItemResponse } from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointGetIdentityTool: ToolConfig<SailPointGetByIdParams, SailPointItemResponse> = {
  id: 'sailpoint_get_identity',
  name: 'SailPoint Get Identity',
  description: 'Get a single SailPoint identity by ID.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Identity ID',
    },
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_get_identity',
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
