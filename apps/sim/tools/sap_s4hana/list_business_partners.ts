import type { ListBusinessPartnersParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildOdataQuery,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const listBusinessPartnersTool: ToolConfig<ListBusinessPartnersParams, SapProxyResponse> = {
  id: 'sap_s4hana_list_business_partners',
  name: 'SAP S/4HANA List Business Partners',
  description:
    'List business partners from SAP S/4HANA Cloud (API_BUSINESS_PARTNER, A_BusinessPartner) with optional OData $filter, $top, $skip, $orderby, $select, $expand.',
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
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'OData $filter expression (e.g., "BusinessPartnerCategory eq \'1\'")',
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
      description: 'Comma-separated navigation properties to expand ($expand)',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_BUSINESS_PARTNER',
      path: '/A_BusinessPartner',
      method: 'GET',
      query: buildOdataQuery(params),
    }),
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP' },
    data: {
      type: 'json',
      description:
        'OData v2 envelope `{ d: { results: [...], __count?, __next? } }`. Properties listed below describe each element of `data.d.results`.',
      properties: {
        BusinessPartner: { type: 'string', description: 'Business partner key (up to 10 chars)' },
        BusinessPartnerFullName: {
          type: 'string',
          description: 'Full name (concatenated first/last or organization name)',
          optional: true,
        },
        BusinessPartnerCategory: {
          type: 'string',
          description: '"1" Person, "2" Organization, "3" Group',
          optional: true,
        },
        BusinessPartnerGrouping: {
          type: 'string',
          description: 'Grouping / number range (tenant-configured)',
          optional: true,
        },
        BusinessPartnerType: {
          type: 'string',
          description: 'Business partner type (tenant-configured)',
          optional: true,
        },
        BusinessPartnerUUID: {
          type: 'string',
          description: 'GUID identifier for the business partner',
          optional: true,
        },
        BusinessPartnerIsBlocked: {
          type: 'boolean',
          description: 'Whether the business partner is centrally blocked',
          optional: true,
        },
        FirstName: { type: 'string', description: 'First name (Person)', optional: true },
        LastName: { type: 'string', description: 'Last name (Person)', optional: true },
        OrganizationBPName1: {
          type: 'string',
          description: 'Organization name line 1',
          optional: true,
        },
        SearchTerm1: { type: 'string', description: 'Search term 1', optional: true },
        CreationDate: {
          type: 'string',
          description: 'Date the partner was created (OData /Date(...)/ literal)',
          optional: true,
        },
        CreatedByUser: {
          type: 'string',
          description: 'User who created the business partner',
          optional: true,
        },
        LastChangeDate: {
          type: 'string',
          description: 'Date of last change (OData /Date(...)/ literal)',
          optional: true,
        },
        LastChangedByUser: {
          type: 'string',
          description: 'User who last changed the business partner',
          optional: true,
        },
      },
    },
  },
}
