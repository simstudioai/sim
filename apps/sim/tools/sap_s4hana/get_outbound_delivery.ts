import type { GetOutboundDeliveryParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildEntityQuery,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const getOutboundDeliveryTool: ToolConfig<GetOutboundDeliveryParams, SapProxyResponse> = {
  id: 'sap_s4hana_get_outbound_delivery',
  name: 'SAP S/4HANA Get Outbound Delivery',
  description:
    'Retrieve a single outbound delivery by DeliveryDocument key from SAP S/4HANA Cloud (API_OUTBOUND_DELIVERY_SRV;v=0002, A_OutbDeliveryHeader).',
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
    deliveryDocument: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'DeliveryDocument key (string, up to 10 characters)',
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
      description:
        'Comma-separated navigation properties to expand (e.g., "to_DeliveryDocumentItem")',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_OUTBOUND_DELIVERY_SRV;v=0002',
      path: `/A_OutbDeliveryHeader(${quoteOdataKey(params.deliveryDocument)})`,
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
          description: 'A_OutbDeliveryHeader entity',
          properties: {
            DeliveryDocument: { type: 'string', description: 'Outbound delivery number' },
            DeliveryDocumentType: { type: 'string', description: 'Delivery document type' },
            SDDocumentCategory: {
              type: 'string',
              description: 'SD document category (e.g., J = outbound delivery)',
              optional: true,
            },
            ShippingPoint: {
              type: 'string',
              description: 'Shipping point',
              optional: true,
            },
            ShippingType: {
              type: 'string',
              description: 'Shipping type',
              optional: true,
            },
            ShipToParty: {
              type: 'string',
              description: 'Ship-to business partner',
              optional: true,
            },
            SoldToParty: {
              type: 'string',
              description: 'Sold-to business partner',
              optional: true,
            },
            DeliveryDate: {
              type: 'string',
              description: 'Delivery date (Edm.DateTime)',
              optional: true,
            },
            ActualGoodsMovementDate: {
              type: 'string',
              description: 'Actual goods issue date (Edm.DateTime)',
              optional: true,
            },
            PlannedGoodsIssueDate: {
              type: 'string',
              description: 'Planned goods issue date (Edm.DateTime)',
              optional: true,
            },
            OverallSDProcessStatus: {
              type: 'string',
              description: 'Overall SD process (delivery) status',
              optional: true,
            },
            OverallGoodsMovementStatus: {
              type: 'string',
              description: 'Overall goods movement status',
              optional: true,
            },
            TransactionCurrency: {
              type: 'string',
              description: 'Document currency',
              optional: true,
            },
            DocumentDate: {
              type: 'string',
              description: 'Document date (Edm.DateTime)',
              optional: true,
            },
            CreationDate: {
              type: 'string',
              description: 'Creation date (Edm.DateTime)',
              optional: true,
            },
            LastChangeDate: {
              type: 'string',
              description: 'Last change date (Edm.DateTime)',
              optional: true,
            },
            to_DeliveryDocumentItem: {
              type: 'json',
              description: 'Delivery items (when $expand=to_DeliveryDocumentItem)',
              optional: true,
            },
            to_DeliveryDocumentPartner: {
              type: 'json',
              description: 'Delivery partners (when $expand=to_DeliveryDocumentPartner)',
              optional: true,
            },
          },
        },
      },
    },
  },
}
