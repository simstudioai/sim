import type { CreateBusinessPartnerParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  parseJsonInput,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const createBusinessPartnerTool: ToolConfig<CreateBusinessPartnerParams, SapProxyResponse> =
  {
    id: 'sap_s4hana_create_business_partner',
    name: 'SAP S/4HANA Create Business Partner',
    description:
      'Create a business partner in SAP S/4HANA Cloud (API_BUSINESS_PARTNER, A_BusinessPartner). For Person category 1 provide FirstName and LastName. For Organization category 2 provide OrganizationBPName1.',
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
      businessPartnerCategory: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'BusinessPartnerCategory: "1" Person, "2" Organization, "3" Group',
      },
      businessPartnerGrouping: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'BusinessPartnerGrouping (number range / role grouping configured in S/4HANA, e.g. "0001")',
      },
      firstName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'FirstName (required for Person)',
      },
      lastName: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'LastName (required for Person)',
      },
      organizationBPName1: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'OrganizationBPName1 (required for Organization)',
      },
      body: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Optional additional A_BusinessPartner fields merged into the create payload',
      },
    },
    request: {
      url: SAP_PROXY_URL,
      method: 'POST',
      headers: () => ({ 'Content-Type': 'application/json' }),
      body: (params) => {
        const extra = parseJsonInput<Record<string, unknown>>(params.body, 'body') ?? {}
        const extraHasName = (key: string) => Object.hasOwn(extra, key) && Boolean(extra[key])
        if (params.businessPartnerCategory === '1') {
          const hasFirst = Boolean(params.firstName) || extraHasName('FirstName')
          const hasLast = Boolean(params.lastName) || extraHasName('LastName')
          if (!hasFirst || !hasLast) {
            throw new Error('BusinessPartnerCategory "1" (Person) requires FirstName and LastName')
          }
        } else if (params.businessPartnerCategory === '2') {
          const hasOrgName =
            Boolean(params.organizationBPName1) || extraHasName('OrganizationBPName1')
          if (!hasOrgName) {
            throw new Error(
              'BusinessPartnerCategory "2" (Organization) requires OrganizationBPName1'
            )
          }
        }
        const payload: Record<string, unknown> = {
          ...extra,
          BusinessPartnerCategory: params.businessPartnerCategory,
          BusinessPartnerGrouping: params.businessPartnerGrouping,
        }
        if (params.firstName) payload.FirstName = params.firstName
        if (params.lastName) payload.LastName = params.lastName
        if (params.organizationBPName1) payload.OrganizationBPName1 = params.organizationBPName1
        return {
          ...baseProxyBody(params),
          service: 'API_BUSINESS_PARTNER',
          path: '/A_BusinessPartner',
          method: 'POST',
          query: { $format: 'json' },
          body: payload,
        }
      },
    },
    transformResponse: transformSapProxyResponse,
    outputs: {
      status: { type: 'number', description: 'HTTP status code returned by SAP (201 on success)' },
      data: {
        type: 'json',
        description: 'Created A_BusinessPartner entity (under d in OData v2)',
        properties: {
          BusinessPartner: {
            type: 'string',
            description: 'Generated business partner key (up to 10 chars)',
          },
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
            description: 'Grouping / number range used to assign the key',
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
          FirstName: { type: 'string', description: 'First name (Person)', optional: true },
          LastName: { type: 'string', description: 'Last name (Person)', optional: true },
          OrganizationBPName1: {
            type: 'string',
            description: 'Organization name line 1',
            optional: true,
          },
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
        },
      },
    },
  }
