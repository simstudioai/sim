import type { ListInboundDeliveriesParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildOdataQuery,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const listInboundDeliveriesTool: ToolConfig<ListInboundDeliveriesParams, SapProxyResponse> =
  {
    id: 'sap_s4hana_list_inbound_deliveries',
    name: 'SAP S/4HANA List Inbound Deliveries',
    description:
      'List inbound deliveries from SAP S/4HANA Cloud (API_INBOUND_DELIVERY_SRV;v=0002, A_InbDeliveryHeader) with optional OData $filter, $top, $skip, $orderby, $select, $expand.',
    version: '1.0.0',
    params: {
      subdomain: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description:
          'SAP BTP subaccount subdomain (technical name of your subaccount, not the S/4HANA host)',
      },
      region: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'BTP region (e.g. eu10, us10)',
      },
      clientId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'OAuth client ID from the S/4HANA Communication Arrangement',
      },
      clientSecret: {
        type: 'string',
        required: true,
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
        description: 'OData $filter expression (e.g., "ReceivingPlant eq \'1010\'")',
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
        service: 'API_INBOUND_DELIVERY_SRV;v=0002',
        path: '/A_InbDeliveryHeader',
        method: 'GET',
        query: buildOdataQuery(params),
      }),
    },
    transformResponse: transformSapProxyResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by SAP' },
      data: { type: 'json', description: 'Array of A_InbDeliveryHeader entities' },
    },
  }
