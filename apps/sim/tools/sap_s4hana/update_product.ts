import type { SapProxyResponse, UpdateProductParams } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  parseJsonInput,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const updateProductTool: ToolConfig<UpdateProductParams, SapProxyResponse> = {
  id: 'sap_s4hana_update_product',
  name: 'SAP S/4HANA Update Product',
  description:
    'Update fields on an A_Product entity in SAP S/4HANA Cloud (API_PRODUCT_SRV). Uses HTTP MERGE (OData v2 partial update) — only the fields you provide are written; existing values are preserved. Flat scalar header fields only — deep/multi-entity updates across navigation properties are not supported by API_PRODUCT_SRV MERGE/PUT (see SAP KBA 2833338); update child entities (plant, valuation, sales data, etc.) via their own endpoints. If-Match defaults to a wildcard (unconditional) — for safe concurrent updates pass the ETag from a prior GET.',
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
    product: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Product key to update (string, up to 40 characters)',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object with A_Product fields to update (e.g., {"ProductGroup":"L001","IsMarkedForDeletion":false})',
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
        service: 'API_PRODUCT_SRV',
        path: `/A_Product(${quoteOdataKey(params.product)})`,
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
      description:
        'Null on 204 success, or OData v2 envelope with the updated A_Product entity at output.data.d',
      properties: {
        d: {
          type: 'json',
          description: 'Updated A_Product entity (only present if SAP returns a body)',
          optional: true,
          properties: {
            Product: { type: 'string', description: 'Product (material) number' },
            ProductType: { type: 'string', description: 'Product type', optional: true },
            ProductGroup: { type: 'string', description: 'Material group', optional: true },
            BaseUnit: { type: 'string', description: 'Base unit of measure', optional: true },
            IsMarkedForDeletion: {
              type: 'boolean',
              description: 'Deletion flag',
              optional: true,
            },
            LastChangeDate: {
              type: 'string',
              description: 'Last change date',
              optional: true,
            },
          },
        },
      },
    },
  },
}
