import type { SapS4HanaResponse, UpdateCustomerParams } from '@/tools/sap_s4hana/types'
import { buildSapOperationBaseInput, parseJsonInput, quoteOdataKey } from '@/tools/sap_s4hana/utils'
import type { InternalToolConfig } from '@/tools/types'

export const updateCustomerTool: InternalToolConfig<UpdateCustomerParams, SapS4HanaResponse> = {
  id: 'sap_s4hana_update_customer',
  name: 'SAP S/4HANA Update Customer',
  description:
    'Update fields on an A_Customer entity in SAP S/4HANA Cloud (API_BUSINESS_PARTNER). Uses HTTP MERGE (OData v2 partial update) — only the fields you provide are written; existing values are preserved. A_Customer is limited to modifiable fields such as OrderIsBlockedForCustomer, DeliveryIsBlocked, BillingIsBlockedForCustomer (Edm.String reason codes like "01"), PostingIsBlocked, and DeletionIndicator (Edm.Boolean). If-Match defaults to a wildcard - for safe concurrent updates pass the ETag from a prior GET to avoid lost updates.',
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
    customer: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer key to update (string, up to 10 characters)',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object with A_Customer fields to update (e.g., {"OrderIsBlockedForCustomer":"01","DeletionIndicator":false}). Block-reason fields are Edm.String codes, not booleans.',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'If-Match ETag for optimistic concurrency. Defaults to "*" (unconditional).',
    },
  },
  operation: {
    input: (params) => {
      const payload = parseJsonInput<Record<string, unknown>>(params.body, 'body')
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('body must be a JSON object with the fields to update')
      }
      return {
        ...buildSapOperationBaseInput(params),
        service: 'API_BUSINESS_PARTNER',
        path: `/A_Customer(${quoteOdataKey(params.customer)})`,
        method: 'MERGE',
        query: { $format: 'json' },
        body: payload,
        ifMatch: params.ifMatch || '*',
      }
    },
  },
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP (204 on success)' },
    data: {
      type: 'object',
      description: 'Null on 204 success, or updated A_Customer entity if SAP returns one',
      properties: {
        Customer: { type: 'string', description: 'Customer key (up to 10 characters)' },
        CustomerName: { type: 'string', description: 'Name of customer' },
        CustomerAccountGroup: { type: 'string', description: 'Customer account group' },
        DeletionIndicator: { type: 'boolean', description: 'Central deletion flag' },
        OrderIsBlockedForCustomer: {
          type: 'string',
          description: 'Central order block reason code',
        },
        PostingIsBlocked: { type: 'boolean', description: 'Central posting block flag' },
        DeliveryIsBlocked: { type: 'string', description: 'Central delivery block reason code' },
        BillingIsBlockedForCustomer: {
          type: 'string',
          description: 'Central billing block reason code',
        },
      },
    },
  },
}
