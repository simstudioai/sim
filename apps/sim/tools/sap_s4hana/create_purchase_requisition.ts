import type { CreatePurchaseRequisitionParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  parseJsonInput,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const createPurchaseRequisitionTool: ToolConfig<
  CreatePurchaseRequisitionParams,
  SapProxyResponse
> = {
  id: 'sap_s4hana_create_purchase_requisition',
  name: 'SAP S/4HANA Create Purchase Requisition',
  description:
    'Create a purchase requisition in SAP S/4HANA Cloud (API_PURCHASEREQ_PROCESS_SRV, A_PurchaseRequisitionHeader). PurchaseRequisition is auto-assigned by SAP from the document number range; provide line items via the to_PurchaseReqnItem deep-insert array. Note: API_PURCHASEREQ_PROCESS_SRV is deprecated since S/4HANA Cloud Public Edition 2402; the successor is API_PURCHASEREQUISITION_2 (OData v4). This tool still works against tenants where the legacy service is enabled.',
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
    purchaseRequisitionType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PurchaseRequisitionType (e.g., "NB" Standard PR)',
    },
    items: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'to_PurchaseReqnItem deep-insert array (e.g., [{"PurchaseRequisitionItem":"10","Material":"TG11","RequestedQuantity":"5","Plant":"1010","BaseUnit":"PC","DeliveryDate":"/Date(1735689600000)/"}])',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Additional A_PurchaseRequisitionHeader fields merged into the create payload (e.g., {"PurReqnDescription":"Office supplies"})',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const items = parseJsonInput<Array<Record<string, unknown>>>(params.items, 'items')
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('items must be a non-empty JSON array of purchase requisition items')
      }
      const extra = parseJsonInput<Record<string, unknown>>(params.body, 'body') ?? {}
      const payload: Record<string, unknown> = {
        ...extra,
        PurchaseRequisitionType: params.purchaseRequisitionType,
        to_PurchaseReqnItem: items,
      }
      return {
        ...baseProxyBody(params),
        service: 'API_PURCHASEREQ_PROCESS_SRV',
        path: '/A_PurchaseRequisitionHeader',
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
          description: 'Created A_PurchaseRequisitionHeader entity',
          properties: {
            PurchaseRequisition: {
              type: 'string',
              description: 'Auto-assigned purchase requisition number',
            },
            PurchaseRequisitionType: {
              type: 'string',
              description: 'PR document type (e.g., NB)',
            },
            PurReqnDescription: {
              type: 'string',
              description: 'Purchase requisition description',
              optional: true,
            },
            SourceDetermination: {
              type: 'string',
              description: 'Source-of-supply determination flag',
              optional: true,
            },
            to_PurchaseReqnItem: {
              type: 'json',
              description: 'Created PR items returned in deep insert',
              optional: true,
            },
          },
        },
      },
    },
  },
}
