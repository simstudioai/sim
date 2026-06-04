import type { GetSalesOrderParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildEntityQuery,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const getSalesOrderTool: ToolConfig<GetSalesOrderParams, SapProxyResponse> = {
  id: 'sap_s4hana_get_sales_order',
  name: 'SAP S/4HANA Get Sales Order',
  description:
    'Retrieve a single sales order by SalesOrder key from SAP S/4HANA Cloud (API_SALES_ORDER_SRV, A_SalesOrder).',
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
      description: 'SalesOrder key (string, up to 10 characters)',
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
      description: 'Comma-separated navigation properties to expand (e.g., "to_Item")',
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
          description: 'A_SalesOrder entity',
          properties: {
            SalesOrder: { type: 'string', description: 'Sales order number' },
            SalesOrderType: { type: 'string', description: 'Sales document type' },
            SalesOrganization: { type: 'string', description: 'Sales organization' },
            DistributionChannel: { type: 'string', description: 'Distribution channel' },
            OrganizationDivision: { type: 'string', description: 'Division' },
            SoldToParty: { type: 'string', description: 'Sold-to business partner' },
            PurchaseOrderByCustomer: {
              type: 'string',
              description: 'Customer purchase order reference',
              optional: true,
            },
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
            PricingDate: {
              type: 'string',
              description: 'Pricing date (OData /Date(ms)/)',
              optional: true,
            },
            LastChangeDate: {
              type: 'string',
              description: 'Last change date (OData /Date(ms)/)',
              optional: true,
            },
            LastChangeDateTime: {
              type: 'string',
              description: 'Last change timestamp (OData /Date(ms)/)',
              optional: true,
            },
            TotalNetAmount: { type: 'string', description: 'Total net amount' },
            TransactionCurrency: { type: 'string', description: 'Document currency' },
            CreationDate: { type: 'string', description: 'Creation date' },
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
            to_Item: {
              type: 'json',
              description: 'Sales order items (when $expand=to_Item)',
              optional: true,
            },
          },
        },
      },
    },
  },
}
