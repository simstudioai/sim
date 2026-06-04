import type { CreateSalesOrderParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  parseJsonInput,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const createSalesOrderTool: ToolConfig<CreateSalesOrderParams, SapProxyResponse> = {
  id: 'sap_s4hana_create_sales_order',
  name: 'SAP S/4HANA Create Sales Order',
  description:
    'Create a sales order in SAP S/4HANA Cloud (API_SALES_ORDER_SRV, A_SalesOrder) with deep insert of sales order items via to_Item.',
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
    salesOrderType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SalesOrderType (e.g., "OR" Standard Order)',
    },
    salesOrganization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SalesOrganization (4 chars, e.g., "1010")',
    },
    distributionChannel: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'DistributionChannel (2 chars, e.g., "10")',
    },
    organizationDivision: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'OrganizationDivision (2 chars, e.g., "00")',
    },
    soldToParty: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SoldToParty business partner key (up to 10 chars)',
    },
    items: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Array of sales order items for to_Item deep insert. Each item should include Material and RequestedQuantity (e.g., [{"Material":"TG11","RequestedQuantity":"1"}]).',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional additional A_SalesOrder fields merged into the create payload',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const items = parseJsonInput<Array<Record<string, unknown>>>(params.items, 'items')
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('items must be a non-empty JSON array of sales order item objects')
      }
      const extra = parseJsonInput<Record<string, unknown>>(params.body, 'body') ?? {}
      const payload: Record<string, unknown> = {
        ...extra,
        SalesOrderType: params.salesOrderType,
        SalesOrganization: params.salesOrganization,
        DistributionChannel: params.distributionChannel,
        OrganizationDivision: params.organizationDivision,
        SoldToParty: params.soldToParty,
        to_Item: items,
      }
      return {
        ...baseProxyBody(params),
        service: 'API_SALES_ORDER_SRV',
        path: '/A_SalesOrder',
        method: 'POST',
        query: { $format: 'json' },
        body: payload,
      }
    },
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP (201 on create)' },
    data: {
      type: 'json',
      description: 'OData v2 response envelope; created entity at output.data.d',
      properties: {
        d: {
          type: 'json',
          description: 'Created A_SalesOrder entity',
          properties: {
            SalesOrder: { type: 'string', description: 'Newly assigned sales order number' },
            SalesOrderType: { type: 'string', description: 'Sales document type' },
            SalesOrganization: { type: 'string', description: 'Sales organization' },
            DistributionChannel: { type: 'string', description: 'Distribution channel' },
            OrganizationDivision: { type: 'string', description: 'Division' },
            SoldToParty: { type: 'string', description: 'Sold-to business partner' },
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
            to_Item: {
              type: 'json',
              description: 'Deep-inserted sales order items as returned by SAP',
              optional: true,
            },
          },
        },
      },
    },
  },
}
