import type { ODataQueryParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  parseJsonInput,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

function normalizeQuery(
  query: ODataQueryParams['query']
): Record<string, string | number | boolean> | undefined {
  if (!query) return undefined
  if (typeof query === 'object') return query
  if (typeof query !== 'string') return undefined
  const trimmed = query.trim()
  if (!trimmed) return undefined
  if (trimmed.startsWith('{')) {
    return parseJsonInput<Record<string, string | number | boolean>>(trimmed, 'query')
  }
  const search = new URLSearchParams(trimmed.startsWith('?') ? trimmed.slice(1) : trimmed)
  const result: Record<string, string> = {}
  for (const [key, value] of search.entries()) result[key] = value
  return result
}

export const odataQueryTool: ToolConfig<ODataQueryParams, SapProxyResponse> = {
  id: 'sap_s4hana_odata_query',
  name: 'SAP S/4HANA OData Query',
  description:
    'Make an arbitrary OData v2 call against any SAP S/4HANA Cloud whitelisted Communication Scenario. Use when no dedicated tool exists for the entity. The proxy handles auth, CSRF, and OData unwrapping. For write operations (POST/PUT/PATCH/MERGE/DELETE), pass an If-Match ETag obtained from a prior GET to avoid lost updates; misuse will mutate production data.',
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
    service: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'OData service name (e.g., "API_BUSINESS_PARTNER", "API_SALES_ORDER_SRV")',
    },
    path: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Path inside the service (e.g., "/A_BusinessPartner" or "/A_BusinessPartner(\'1000123\')")',
    },
    method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTTP method: GET (default), POST, PATCH, PUT, DELETE, MERGE',
    },
    query: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'OData query parameters as JSON object or query string (e.g., {"$filter":"BusinessPartnerCategory eq \'1\'","$top":10}). $format=json is added automatically when omitted.',
    },
    body: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON request body for write operations',
    },
    ifMatch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'ETag value for the If-Match header (required by SAP for PATCH/PUT/DELETE on existing entities)',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const query = normalizeQuery(params.query) ?? {}
      if (!('$format' in query)) query.$format = 'json'
      const requestBody: Record<string, unknown> = {
        ...baseProxyBody(params),
        service: params.service,
        path: params.path,
        method: params.method || 'GET',
        query,
      }
      const parsedBody = parseJsonInput<Record<string, unknown>>(params.body, 'body')
      if (parsedBody !== undefined) requestBody.body = parsedBody
      if (params.ifMatch) requestBody.ifMatch = params.ifMatch
      return requestBody
    },
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP' },
    data: {
      type: 'json',
      description: 'Parsed OData payload (entity, collection, or null on 204)',
    },
  },
}
