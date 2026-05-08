import type { GetProductParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildEntityQuery,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const getProductTool: ToolConfig<GetProductParams, SapProxyResponse> = {
  id: 'sap_s4hana_get_product',
  name: 'SAP S/4HANA Get Product',
  description:
    'Retrieve a single product (material) by Product key from SAP S/4HANA Cloud (API_PRODUCT_SRV, A_Product).',
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
      description: 'Product key (string, up to 40 characters)',
    },
    select: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated fields to return ($select)',
    },
    expand: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated navigation properties to expand (e.g., "to_Description")',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_PRODUCT_SRV',
      path: `/A_Product(${quoteOdataKey(params.product)})`,
      method: 'GET',
      query: buildEntityQuery(params),
    }),
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP' },
    data: {
      type: 'json',
      description: 'OData v2 response envelope; entity at output.data.d',
      properties: {
        d: {
          type: 'json',
          description: 'A_Product entity',
          properties: {
            Product: {
              type: 'string',
              description: 'Product (material) number',
              optional: true,
            },
            ProductType: {
              type: 'string',
              description: 'Product type (e.g., FERT, HAWA)',
              optional: true,
            },
            ProductGroup: { type: 'string', description: 'Material group', optional: true },
            BaseUnit: { type: 'string', description: 'Base unit of measure', optional: true },
            Brand: { type: 'string', description: 'Brand', optional: true },
            Division: { type: 'string', description: 'Division', optional: true },
            GrossWeight: { type: 'string', description: 'Gross weight', optional: true },
            NetWeight: { type: 'string', description: 'Net weight', optional: true },
            WeightUnit: {
              type: 'string',
              description: 'Weight unit of measure',
              optional: true,
            },
            CrossPlantStatus: {
              type: 'string',
              description: 'Cross-plant material status',
              optional: true,
            },
            IsMarkedForDeletion: {
              type: 'boolean',
              description: 'Deletion flag',
              optional: true,
            },
            ProductStandardID: {
              type: 'string',
              description: 'Standard product ID (e.g., GTIN)',
              optional: true,
            },
            ItemCategoryGroup: {
              type: 'string',
              description: 'Item category group',
              optional: true,
            },
            ProductOldID: {
              type: 'string',
              description: 'Legacy/old product ID',
              optional: true,
            },
            CreatedByUser: {
              type: 'string',
              description: 'User who created the product',
              optional: true,
            },
            CreationDate: {
              type: 'string',
              description: 'Creation date (OData /Date(ms)/)',
              optional: true,
            },
            LastChangedByUser: {
              type: 'string',
              description: 'User who last changed the product',
              optional: true,
            },
            LastChangeDate: {
              type: 'string',
              description: 'Last change date',
              optional: true,
            },
            LastChangeDateTime: {
              type: 'string',
              description: 'Last change timestamp (Edm.DateTimeOffset)',
              optional: true,
            },
            to_Description: {
              type: 'json',
              description: 'Product descriptions (when $expand=to_Description)',
              optional: true,
            },
            to_Plant: {
              type: 'json',
              description: 'Plant-level data (when $expand=to_Plant)',
              optional: true,
            },
            to_ProductSales: {
              type: 'json',
              description: 'Sales data (when $expand=to_ProductSales)',
              optional: true,
            },
          },
        },
      },
    },
  },
}
