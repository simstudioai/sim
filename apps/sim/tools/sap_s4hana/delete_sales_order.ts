import type { DeleteSalesOrderParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const deleteSalesOrderTool: ToolConfig<DeleteSalesOrderParams, SapProxyResponse> = {
  id: 'sap_s4hana_delete_sales_order',
  name: 'SAP S/4HANA Delete Sales Order',
  description:
    'Delete an A_SalesOrder entity in SAP S/4HANA Cloud (API_SALES_ORDER_SRV). Only orders without subsequent documents (deliveries, invoices) can be deleted; otherwise reject items via update instead.',
  version: '1.0.0',
  params: {
    subdomain: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'SAP BTP subaccount subdomain (technical name of your subaccount, not the S/4HANA host)',
    },
    region: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'BTP region (e.g. eu10, us10)',
    },
    clientId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth client ID from the S/4HANA Communication Arrangement',
    },
    clientSecret: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth client secret from the S/4HANA Communication Arrangement',
    },
    deploymentType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Deployment type: cloud_public (default), cloud_private, or on_premise',
    },
    authType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Authentication type: oauth_client_credentials (default) or basic',
    },
    baseUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Base URL of the S/4HANA host (Cloud Private / On-Premise)',
    },
    tokenUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth token URL (Cloud Private / On-Premise + OAuth)',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username for HTTP Basic auth',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password for HTTP Basic auth',
    },
    salesOrder: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SalesOrder key to delete (string, up to 10 characters)',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'If-Match ETag for optimistic concurrency. Defaults to "*" (unconditional).',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_SALES_ORDER_SRV',
      path: `/A_SalesOrder(${quoteOdataKey(params.salesOrder)})`,
      method: 'DELETE',
      ifMatch: params.ifMatch || '*',
    }),
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP (204 on success)' },
    data: {
      type: 'json',
      description: 'Null on successful deletion (SAP returns 204 No Content)',
      optional: true,
    },
  },
}
