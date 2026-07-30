import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointWriteOutputs,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointCancelAccessRequestParams,
  SailPointWriteResponse,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointCancelAccessRequestTool: ToolConfig<
  SailPointCancelAccessRequestParams,
  SailPointWriteResponse
> = {
  id: 'sailpoint_cancel_access_request',
  name: 'SailPoint Cancel Access Request',
  description: 'Cancel a pending SailPoint access request by its identity request ID.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    accountActivityId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The identityRequestId of the access request to cancel',
    },
    comment: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reason for cancellation',
    },
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_cancel_access_request',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      accountActivityId: params.accountActivityId,
      comment: params.comment,
    }),
  },

  transformResponse: (response) =>
    unwrapSailPointOutput<{ accepted: boolean; status: number }>(response),

  outputs: sailpointWriteOutputs,
}
