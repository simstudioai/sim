import {
  SAILPOINT_LOAD_ROUTE,
  sailpointCredentialParams,
  sailpointTaskOutputs,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointLoadEntitlementsParams,
  SailPointTaskResponse,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointLoadEntitlementsTool: ToolConfig<
  SailPointLoadEntitlementsParams,
  SailPointTaskResponse
> = {
  id: 'sailpoint_load_entitlements',
  name: 'SailPoint Load Entitlements',
  description:
    'Trigger an entitlement aggregation for a SailPoint source, optionally uploading a CSV of entitlements.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    sourceId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source ID to aggregate',
    },
    file: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'CSV file of entitlements to aggregate (delimited-file sources only)',
    },
  },

  request: {
    url: SAILPOINT_LOAD_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_load_entitlements',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      sourceId: params.sourceId,
      file: params.file,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<{ task: unknown }>(response),

  outputs: sailpointTaskOutputs,
}
