import type { CreatePurchaseOrderParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  parseJsonInput,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const createPurchaseOrderTool: ToolConfig<CreatePurchaseOrderParams, SapProxyResponse> = {
  id: 'sap_s4hana_create_purchase_order',
  name: 'SAP S/4HANA Create Purchase Order',
  description:
    'Create a purchase order in SAP S/4HANA Cloud (API_PURCHASEORDER_PROCESS_SRV, A_PurchaseOrder). PurchaseOrder is auto-assigned by SAP from the document number range; provide line items via the body parameter.',
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
    purchaseOrderType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PurchaseOrderType (e.g., "NB" Standard PO)',
    },
    companyCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'CompanyCode (4 chars, e.g., "1010")',
    },
    purchasingOrganization: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PurchasingOrganization (4 chars)',
    },
    purchasingGroup: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PurchasingGroup (3 chars)',
    },
    supplier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Supplier business partner key (up to 10 chars)',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'A_PurchaseOrder body containing to_PurchaseOrderItem deep-insert items (required by SAP) plus any additional header fields, e.g., {"to_PurchaseOrderItem":[{"PurchaseOrderItem":"10","Material":"TG11","OrderQuantity":"5","Plant":"1010","PurchaseOrderQuantityUnit":"PC","NetPriceAmount":"100.00","DocumentCurrency":"USD"}]}.',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const extra = parseJsonInput<Record<string, unknown>>(params.body, 'body') ?? {}
      const items = Array.isArray(extra.to_PurchaseOrderItem) ? extra.to_PurchaseOrderItem : null
      if (!items || items.length === 0) {
        throw new Error(
          'body must include a non-empty "to_PurchaseOrderItem" array of purchase order line items'
        )
      }
      const payload: Record<string, unknown> = {
        ...extra,
        PurchaseOrderType: params.purchaseOrderType,
        CompanyCode: params.companyCode,
        PurchasingOrganization: params.purchasingOrganization,
        PurchasingGroup: params.purchasingGroup,
        Supplier: params.supplier,
      }
      return {
        ...baseProxyBody(params),
        service: 'API_PURCHASEORDER_PROCESS_SRV',
        path: '/A_PurchaseOrder',
        method: 'POST',
        query: { $format: 'json' },
        body: payload,
      }
    },
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP' },
    data: {
      type: 'json',
      description: 'OData v2 response envelope; created entity at output.data.d',
      properties: {
        d: {
          type: 'json',
          description: 'Created A_PurchaseOrder entity',
          properties: {
            PurchaseOrder: { type: 'string', description: 'Auto-assigned purchase order number' },
            PurchaseOrderType: { type: 'string', description: 'PO document type' },
            CompanyCode: { type: 'string', description: 'Company code' },
            PurchasingOrganization: { type: 'string', description: 'Purchasing organization' },
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
            to_PurchaseOrderItem: {
              type: 'json',
              description: 'Created PO items returned in deep insert',
              optional: true,
            },
          },
        },
      },
    },
  },
}
