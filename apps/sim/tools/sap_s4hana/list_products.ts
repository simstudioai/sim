import type { ListProductsParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildOdataQuery,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const listProductsTool: ToolConfig<ListProductsParams, SapProxyResponse> = {
  id: 'sap_s4hana_list_products',
  name: 'SAP S/4HANA List Products',
  description:
    'List products (materials) from SAP S/4HANA Cloud (API_PRODUCT_SRV, A_Product) with optional OData $filter, $top, $skip, $orderby, $select, $expand.',
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
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OData $filter expression (e.g., "ProductType eq \'FERT\'")',
    },
    top: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum results to return ($top)',
    },
    skip: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results to skip ($skip)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OData $orderby expression',
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
      description: 'Comma-separated navigation properties to expand ($expand)',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_PRODUCT_SRV',
      path: '/A_Product',
      method: 'GET',
      query: buildOdataQuery(params),
    }),
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP' },
    data: {
      type: 'json',
      description: 'OData v2 response envelope; collection at output.data.d.results',
      properties: {
        d: {
          type: 'json',
          description: 'OData v2 envelope',
          properties: {
            results: {
              type: 'array',
              description: 'A_Product entities',
              items: {
                type: 'object',
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
                  ProductGroup: {
                    type: 'string',
                    description: 'Material group',
                    optional: true,
                  },
                  BaseUnit: {
                    type: 'string',
                    description: 'Base unit of measure',
                    optional: true,
                  },
                  Brand: { type: 'string', description: 'Brand', optional: true },
                  Division: { type: 'string', description: 'Division', optional: true },
                  GrossWeight: {
                    type: 'string',
                    description: 'Gross weight',
                    optional: true,
                  },
                  NetWeight: {
                    type: 'string',
                    description: 'Net weight',
                    optional: true,
                  },
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
                },
              },
            },
            __next: {
              type: 'string',
              description: 'OData skiptoken URL for next page',
              optional: true,
            },
            __count: {
              type: 'string',
              description: 'Total count when $inlinecount=allpages is used',
              optional: true,
            },
          },
        },
      },
    },
  },
}
