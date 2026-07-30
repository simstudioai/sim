import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointWriteOutputs,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type { SailPointRequestAccessParams, SailPointWriteResponse } from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Submits an access request in SailPoint. REVOKE_ACCESS is limited to exactly one identity and
 * one entitlement per request (with a mandatory comment) and cannot revoke role-membership or
 * birthright access - those must be removed at their source.
 */
export const sailpointRequestAccessTool: ToolConfig<
  SailPointRequestAccessParams,
  SailPointWriteResponse
> = {
  id: 'sailpoint_request_access',
  name: 'SailPoint Request Access',
  description:
    'Submit a SailPoint access request to grant, revoke, or modify access for one or more identities.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    requestedFor: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description: 'Array of identity IDs. For REVOKE_ACCESS exactly one identity.',
    },
    requestedItems: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of { type: ACCESS_PROFILE|ROLE|ENTITLEMENT, id, comment?, removeDate?, startDate?, assignmentId?, nativeIdentity?, clientMetadata? }. REVOKE requires exactly one item with a comment.',
    },
    requestType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'GRANT_ACCESS (default), REVOKE_ACCESS, or MODIFY_ACCESS',
    },
    clientMetadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional key/value map, e.g. to record the human requester for correlation',
    },
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_request_access',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      requestedFor: params.requestedFor,
      requestedItems: params.requestedItems,
      requestType: params.requestType,
      clientMetadata: params.clientMetadata,
    }),
  },

  transformResponse: (response) =>
    unwrapSailPointOutput<{ accepted: boolean; status: number }>(response),

  outputs: sailpointWriteOutputs,
}
