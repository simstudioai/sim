import type { GetCustomerParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildEntityQuery,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const getCustomerTool: ToolConfig<GetCustomerParams, SapProxyResponse> = {
  id: 'sap_s4hana_get_customer',
  name: 'SAP S/4HANA Get Customer',
  description:
    'Retrieve a single customer by Customer key from SAP S/4HANA Cloud (API_BUSINESS_PARTNER, A_Customer).',
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
    customer: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Customer key (string, up to 10 characters)',
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
        'Comma-separated navigation properties to expand (e.g., "to_CustomerCompany,to_CustomerSalesArea")',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_BUSINESS_PARTNER',
      path: `/A_Customer(${quoteOdataKey(params.customer)})`,
      method: 'GET',
      query: buildEntityQuery(params),
    }),
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP' },
    data: {
      type: 'object',
      description: 'A_Customer entity',
      properties: {
        Customer: { type: 'string', description: 'Customer key (up to 10 characters)' },
        CustomerName: { type: 'string', description: 'Name of customer' },
        CustomerFullName: { type: 'string', description: 'Full name of the customer' },
        CustomerAccountGroup: { type: 'string', description: 'Customer account group' },
        CustomerClassification: { type: 'string', description: 'Customer classification code' },
        CustomerCorporateGroup: { type: 'string', description: 'Corporate group code' },
        AuthorizationGroup: { type: 'string', description: 'Authorization group' },
        Supplier: { type: 'string', description: 'Linked supplier account number' },
        FiscalAddress: { type: 'string', description: 'Fiscal address ID' },
        Industry: { type: 'string', description: 'Industry key' },
        NielsenRegion: { type: 'string', description: 'Nielsen ID' },
        ResponsibleType: { type: 'string', description: 'Responsible type' },
        NFPartnerIsNaturalPerson: { type: 'string', description: 'Natural person indicator' },
        InternationalLocationNumber1: {
          type: 'string',
          description: 'International location number 1',
        },
        TaxNumberType: { type: 'string', description: 'Tax number type' },
        VATRegistration: { type: 'string', description: 'VAT registration number' },
        DeletionIndicator: { type: 'boolean', description: 'Central deletion flag' },
        OrderIsBlockedForCustomer: {
          type: 'string',
          description: 'Central order block reason code',
        },
        PostingIsBlocked: { type: 'boolean', description: 'Central posting block flag' },
        DeliveryIsBlocked: { type: 'string', description: 'Central delivery block reason code' },
        BillingIsBlockedForCustomer: {
          type: 'string',
          description: 'Central billing block reason code',
        },
        CreationDate: { type: 'string', description: 'Creation date (OData v2 epoch)' },
        CreatedByUser: { type: 'string', description: 'User who created the customer' },
      },
    },
  },
}
