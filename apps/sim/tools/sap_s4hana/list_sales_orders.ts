import type { ListSalesOrdersParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildOdataQuery,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const listSalesOrdersTool: ToolConfig<ListSalesOrdersParams, SapProxyResponse> = {
  id: 'sap_s4hana_list_sales_orders',
  name: 'SAP S/4HANA List Sales Orders',
  description:
    'List sales orders from SAP S/4HANA Cloud (API_SALES_ORDER_SRV, A_SalesOrder) with optional OData $filter, $top, $skip, $orderby, $select, $expand.',
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
      description: 'OData $filter expression (e.g., "SalesOrganization eq \'1010\'")',
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
      description: 'Comma-separated navigation properties to expand (e.g., "to_Item,to_Partner")',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_SALES_ORDER_SRV',
      path: '/A_SalesOrder',
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
              description: 'A_SalesOrder entities',
              items: {
                type: 'object',
                properties: {
                  SalesOrder: { type: 'string', description: 'Sales order number' },
                  SalesOrderType: { type: 'string', description: 'Sales document type (e.g., OR)' },
                  SalesOrganization: { type: 'string', description: 'Sales organization' },
                  DistributionChannel: { type: 'string', description: 'Distribution channel' },
                  OrganizationDivision: { type: 'string', description: 'Division' },
                  SoldToParty: { type: 'string', description: 'Sold-to business partner' },
                  TotalNetAmount: { type: 'string', description: 'Total net amount' },
                  TransactionCurrency: { type: 'string', description: 'Document currency' },
                  CreationDate: { type: 'string', description: 'Creation date (OData /Date(ms)/)' },
                  SalesOrderDate: {
                    type: 'string',
                    description: 'Sales order date (OData /Date(ms)/)',
                    optional: true,
                  },
                  RequestedDeliveryDate: {
                    type: 'string',
                    description: 'Requested delivery date (OData /Date(ms)/)',
                    optional: true,
                  },
                  LastChangeDate: {
                    type: 'string',
                    description: 'Last change date (OData /Date(ms)/)',
                    optional: true,
                  },
                  PurchaseOrderByCustomer: {
                    type: 'string',
                    description: 'Customer purchase order reference',
                    optional: true,
                  },
                  OverallSDProcessStatus: {
                    type: 'string',
                    description: 'Overall sales document process status',
                    optional: true,
                  },
                  OverallTotalDeliveryStatus: {
                    type: 'string',
                    description: 'Overall total delivery status',
                    optional: true,
                  },
                  OverallSDDocumentRejectionSts: {
                    type: 'string',
                    description: 'Overall sales document rejection status',
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
          },
        },
      },
    },
  },
}
