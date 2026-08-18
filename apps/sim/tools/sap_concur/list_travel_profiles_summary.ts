import type {
  ListTravelProfilesSummaryParams,
  SapConcurProxyResponse,
} from '@/tools/sap_concur/types'
import {
  baseProxyBody,
  buildListQuery,
  SAP_CONCUR_PROXY_URL,
  transformSapConcurProxyResponse,
  trimRequired,
} from '@/tools/sap_concur/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Travel Profile v2 serves this endpoint as XML only (Accept: application/xml, schema
 * TravelProfileSummaryV2.xsd) — there is no JSON representation. The shared proxy therefore
 * surfaces the payload as a raw XML string in `data`, which downstream blocks are expected
 * to parse.
 */
export const listTravelProfilesSummaryTool: ToolConfig<
  ListTravelProfilesSummaryParams,
  SapConcurProxyResponse
> = {
  id: 'sap_concur_list_travel_profiles_summary',
  name: 'SAP Concur List Travel Profiles Summary',
  description:
    'List travel profile summaries (GET /api/travelprofile/v2.0/summary). LastModifiedDate is required by Concur.',
  version: '1.0.0',
  params: {
    datacenter: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Concur datacenter base URL (defaults to us.api.concursolutions.com)',
    },
    grantType: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'OAuth grant type: client_credentials (default) or password',
    },
    clientId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client ID',
    },
    clientSecret: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Concur OAuth client secret',
    },
    username: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Username (only for password grant)',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password (only for password grant)',
    },
    companyUuid: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Company UUID for multi-company access tokens',
    },
    lastModifiedDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Required UTC datetime in YYYY-MM-DDThh:mm:ss format',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: '1-based page number',
    },
    itemsPerPage: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Items per page (max 200)',
    },
    travelConfigs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated travel configuration ids',
    },
    active: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by user state: "1" returns active users, "0" returns inactive users.',
    },
  },
  request: {
    url: SAP_CONCUR_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => {
      const lastModifiedDate = trimRequired(params.lastModifiedDate, 'lastModifiedDate')
      const query = buildListQuery({
        LastModifiedDate: lastModifiedDate,
        Page: params.page,
        ItemsPerPage: params.itemsPerPage,
        travelConfigs: params.travelConfigs,
        Active: params.active,
      })
      return {
        ...baseProxyBody(params),
        path: '/api/travelprofile/v2.0/summary',
        method: 'GET',
        accept: 'application/xml',
        query,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'string',
      description:
        'Raw XML travel profile summary list returned by Concur (Travel Profile v2 emits application/xml only, per the TravelProfileSummaryV2.xsd schema, so this is a string and not a parsed object). The document is rooted at <ConnectResponse> with ConnectResponse > Metadata > Paging (TotalPages, TotalItems, Page, ItemsPerPage, PreviousPageURL, NextPageURL) and ConnectResponse > Data > ProfileSummary, whose only child elements are Status, LoginID, XmlProfileSyncID, and ProfileLastModifiedUTC.',
    },
  },
}
