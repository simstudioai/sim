import type { GetMaterialDocumentParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildEntityQuery,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const getMaterialDocumentTool: ToolConfig<GetMaterialDocumentParams, SapProxyResponse> = {
  id: 'sap_s4hana_get_material_document',
  name: 'SAP S/4HANA Get Material Document',
  description:
    'Retrieve a single material document header by composite key (MaterialDocument + MaterialDocumentYear) from SAP S/4HANA Cloud (API_MATERIAL_DOCUMENT_SRV, A_MaterialDocumentHeader).',
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
    materialDocumentYear: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'MaterialDocumentYear (4-character year, e.g., "2024")',
    },
    materialDocument: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'MaterialDocument key (string, up to 10 characters)',
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
        'Comma-separated navigation properties to expand (e.g., "to_MaterialDocumentItem")',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_MATERIAL_DOCUMENT_SRV',
      path: `/A_MaterialDocumentHeader(MaterialDocument=${quoteOdataKey(params.materialDocument)},MaterialDocumentYear=${quoteOdataKey(params.materialDocumentYear)})`,
      method: 'GET',
      query: buildEntityQuery(params),
    }),
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP' },
    data: { type: 'json', description: 'A_MaterialDocumentHeader entity' },
  },
}
