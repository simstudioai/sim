import type { SapProxyResponse, UpdateSupplierParams } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  parseJsonInput,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const updateSupplierTool: ToolConfig<UpdateSupplierParams, SapProxyResponse> = {
  id: 'sap_s4hana_update_supplier',
  name: 'SAP S/4HANA Update Supplier',
  description:
    'Update fields on an A_Supplier entity in SAP S/4HANA Cloud (API_BUSINESS_PARTNER). PATCH only sends the fields you provide; existing values are preserved. A_Supplier PATCH is limited to modifiable fields such as PostingIsBlocked, PurchasingIsBlocked, PaymentIsBlockedForSupplier, DeletionIndicator, and SupplierAccountGroup. If-Match defaults to a wildcard - for safe concurrent updates pass the ETag from a prior GET to avoid lost updates.',
  version: '1.0.0',
  params: {
    subdomain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'SAP BTP subaccount subdomain (technical name of your subaccount, not the S/4HANA host)',
    },
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'BTP region (e.g. eu10, us10)',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'OAuth client ID from the S/4HANA Communication Arrangement',
    },
    clientSecret: {
      type: 'string',
      required: true,
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
    supplier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Supplier key to update (string, up to 10 characters)',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object with A_Supplier fields to update (e.g., {"PaymentIsBlockedForSupplier":true,"PostingIsBlocked":true})',
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
    body: (params) => {
      const payload = parseJsonInput<Record<string, unknown>>(params.body, 'body')
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('body must be a JSON object with the fields to update')
      }
      return {
        ...baseProxyBody(params),
        service: 'API_BUSINESS_PARTNER',
        path: `/A_Supplier(${quoteOdataKey(params.supplier)})`,
        method: 'MERGE',
        query: { $format: 'json' },
        body: payload,
        ifMatch: params.ifMatch || '*',
      }
    },
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP (204 on success)' },
    data: {
      type: 'json',
      description: 'Null on 204 success, or updated A_Supplier entity if SAP returns one',
    },
  },
}
