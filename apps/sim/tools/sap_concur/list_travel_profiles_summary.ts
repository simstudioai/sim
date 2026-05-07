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
      })
      return {
        ...baseProxyBody(params),
        path: '/api/travelprofile/v2.0/summary',
        method: 'GET',
        query,
      }
    },
  },
  transformResponse: transformSapConcurProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by Concur' },
    data: {
      type: 'json',
      description: 'Travel profile summary list payload (Concur returns XML mapped to JSON)',
      properties: {
        Metadata: {
          type: 'json',
          description: 'Paging metadata',
          optional: true,
          properties: {
            Paging: {
              type: 'json',
              description: 'Pagination details',
              optional: true,
              properties: {
                TotalPages: {
                  type: 'number',
                  description: 'Total number of pages',
                  optional: true,
                },
                TotalItems: {
                  type: 'number',
                  description: 'Total number of items',
                  optional: true,
                },
                Page: {
                  type: 'number',
                  description: 'Current page',
                  optional: true,
                },
                ItemsPerPage: {
                  type: 'number',
                  description: 'Items per page',
                  optional: true,
                },
                PreviousPageURL: {
                  type: 'string',
                  description: 'URL to the previous page',
                  optional: true,
                },
                NextPageURL: {
                  type: 'string',
                  description: 'URL to the next page',
                  optional: true,
                },
              },
            },
          },
        },
        Data: {
          type: 'array',
          description: 'Array of travel profile summaries',
          optional: true,
          items: {
            type: 'json',
            properties: {
              Status: { type: 'string', description: 'Status (Active/Inactive)', optional: true },
              LoginID: { type: 'string', description: 'Login identifier', optional: true },
              XmlProfileSyncID: {
                type: 'string',
                description: 'XML profile sync identifier',
                optional: true,
              },
              ProfileLastModifiedUTC: {
                type: 'string',
                description: 'Last modified timestamp (UTC)',
                optional: true,
              },
              RuleClass: {
                type: 'string',
                description: 'Travel rule class assigned to the profile',
                optional: true,
              },
              TravelConfigID: {
                type: 'string',
                description: 'Travel configuration identifier',
                optional: true,
              },
              UUID: { type: 'string', description: 'Profile UUID', optional: true },
              EmployeeID: { type: 'string', description: 'Employee ID', optional: true },
              CompanyID: { type: 'string', description: 'Company ID', optional: true },
            },
          },
        },
      },
    },
  },
}
