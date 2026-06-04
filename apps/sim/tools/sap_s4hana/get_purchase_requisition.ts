import type { GetPurchaseRequisitionParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildEntityQuery,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const getPurchaseRequisitionTool: ToolConfig<
  GetPurchaseRequisitionParams,
  SapProxyResponse
> = {
  id: 'sap_s4hana_get_purchase_requisition',
  name: 'SAP S/4HANA Get Purchase Requisition',
  description:
    'Retrieve a single purchase requisition by PurchaseRequisition key from SAP S/4HANA Cloud (API_PURCHASEREQ_PROCESS_SRV, A_PurchaseRequisitionHeader). Note: API_PURCHASEREQ_PROCESS_SRV is deprecated since S/4HANA Cloud Public Edition 2402; the successor is API_PURCHASEREQUISITION_2 (OData v4). This tool still works against tenants where the legacy service is enabled.',
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
    purchaseRequisition: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PurchaseRequisition key (string, up to 10 characters)',
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
      description: 'Comma-separated navigation properties to expand (e.g., "to_PurchaseReqnItem")',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_PURCHASEREQ_PROCESS_SRV',
      path: `/A_PurchaseRequisitionHeader(${quoteOdataKey(params.purchaseRequisition)})`,
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
          description: 'A_PurchaseRequisitionHeader entity',
          properties: {
            PurchaseRequisition: {
              type: 'string',
              description: 'Purchase requisition number',
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
              description: 'Expanded PR items (when $expand=to_PurchaseReqnItem)',
              optional: true,
            },
          },
        },
      },
    },
  },
}
