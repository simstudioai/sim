import type { ListPurchaseOrdersParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildOdataQuery,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const listPurchaseOrdersTool: ToolConfig<ListPurchaseOrdersParams, SapProxyResponse> = {
  id: 'sap_s4hana_list_purchase_orders',
  name: 'SAP S/4HANA List Purchase Orders',
  description:
    'List purchase orders from SAP S/4HANA Cloud (API_PURCHASEORDER_PROCESS_SRV, A_PurchaseOrder) with optional OData $filter, $top, $skip, $orderby, $select, $expand.',
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
      description: 'OData $filter expression (e.g., "CompanyCode eq \'1010\'")',
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
      description: 'Comma-separated navigation properties to expand (e.g., "to_PurchaseOrderItem")',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_PURCHASEORDER_PROCESS_SRV',
      path: '/A_PurchaseOrder',
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
              description: 'A_PurchaseOrder entities',
              items: {
                type: 'object',
                properties: {
                  PurchaseOrder: { type: 'string', description: 'Purchase order number' },
                  PurchaseOrderType: {
                    type: 'string',
                    description: 'PO document type (e.g., NB)',
                  },
                  CompanyCode: { type: 'string', description: 'Company code' },
                  PurchasingOrganization: {
                    type: 'string',
                    description: 'Purchasing organization',
                  },
                  PurchasingGroup: { type: 'string', description: 'Purchasing group' },
                  Supplier: { type: 'string', description: 'Supplier business partner key' },
                  DocumentCurrency: {
                    type: 'string',
                    description: 'Document currency',
                    optional: true,
                  },
                  NetAmount: {
                    type: 'string',
                    description: 'Net amount of the purchase order',
                    optional: true,
                  },
                  CreationDate: {
                    type: 'string',
                    description: 'Creation date (OData /Date(ms)/)',
                    optional: true,
                  },
                  CreatedByUser: {
                    type: 'string',
                    description: 'User who created the PO',
                    optional: true,
                  },
                  PurchaseOrderDate: {
                    type: 'string',
                    description: 'Purchase order date',
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
