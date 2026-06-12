import type { SapProxyResponse, UpdatePurchaseRequisitionParams } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  parseJsonInput,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const updatePurchaseRequisitionTool: ToolConfig<
  UpdatePurchaseRequisitionParams,
  SapProxyResponse
> = {
  id: 'sap_s4hana_update_purchase_requisition',
  name: 'SAP S/4HANA Update Purchase Requisition',
  description:
    'Update fields on an A_PurchaseRequisitionHeader entity in SAP S/4HANA Cloud (API_PURCHASEREQ_PROCESS_SRV; deprecated since S/4HANA 2402, successor is API_PURCHASEREQUISITION_2 OData v4). Uses HTTP MERGE (OData v2 partial update) — only the fields you provide are written; existing values are preserved. Header-only — deep updates across navigations are not supported (SAP KBA 2833338); use the A_PurchaseReqnItem entity directly to modify items. If-Match defaults to a wildcard - for safe concurrent updates pass the ETag from a prior GET to avoid lost updates.',
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
      description: 'PurchaseRequisition key to update (string, up to 10 characters)',
    },
    body: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object with A_PurchaseRequisitionHeader fields to update (e.g., {"PurchaseRequisitionType":"NB"})',
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
        service: 'API_PURCHASEREQ_PROCESS_SRV',
        path: `/A_PurchaseRequisitionHeader(${quoteOdataKey(params.purchaseRequisition)})`,
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
        'Null on 204 success, or OData v2 envelope with updated A_PurchaseRequisitionHeader at output.data.d',
      properties: {
        d: {
          type: 'json',
          description: 'Updated A_PurchaseRequisitionHeader entity (if returned)',
          optional: true,
          properties: {
            PurchaseRequisition: {
              type: 'string',
              description: 'Purchase requisition number',
            },
            PurchaseRequisitionType: {
              type: 'string',
              description: 'PR document type',
              optional: true,
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
          },
        },
      },
    },
  },
}
