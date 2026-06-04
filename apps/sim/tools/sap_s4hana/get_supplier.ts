import type { GetSupplierParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildEntityQuery,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const getSupplierTool: ToolConfig<GetSupplierParams, SapProxyResponse> = {
  id: 'sap_s4hana_get_supplier',
  name: 'SAP S/4HANA Get Supplier',
  description:
    'Retrieve a single supplier by Supplier key from SAP S/4HANA Cloud (API_BUSINESS_PARTNER, A_Supplier).',
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
    supplier: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Supplier key (string, up to 10 characters)',
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
        'Comma-separated navigation properties to expand (e.g., "to_SupplierCompany,to_SupplierPurchasingOrg")',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_BUSINESS_PARTNER',
      path: `/A_Supplier(${quoteOdataKey(params.supplier)})`,
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
          description: 'A_Supplier entity',
          properties: {
            Supplier: { type: 'string', description: 'Supplier key (up to 10 characters)' },
            AlternativePayeeAccountNumber: {
              type: 'string',
              description: 'Account number of the alternative payee',
              optional: true,
            },
            AuthorizationGroup: {
              type: 'string',
              description: 'Authorization group',
              optional: true,
            },
            BusinessPartner: {
              type: 'string',
              description: 'Linked BusinessPartner key',
              optional: true,
            },
            BR_TaxIsSplit: {
              type: 'boolean',
              description: 'Brazil-specific tax split flag',
              optional: true,
            },
            CreatedByUser: {
              type: 'string',
              description: 'User who created the supplier',
              optional: true,
            },
            CreationDate: {
              type: 'string',
              description: 'Creation date (OData v2 epoch)',
              optional: true,
            },
            Customer: {
              type: 'string',
              description: 'Linked customer key (if any)',
              optional: true,
            },
            DeletionIndicator: {
              type: 'boolean',
              description: 'Central deletion flag',
              optional: true,
            },
            BirthDate: {
              type: 'string',
              description: 'Date of birth (OData v2 epoch)',
              optional: true,
            },
            ConcatenatedInternationalLocNo: {
              type: 'string',
              description: 'Concatenated international location number',
              optional: true,
            },
            FiscalAddress: {
              type: 'string',
              description: 'Fiscal address number',
              optional: true,
            },
            Industry: { type: 'string', description: 'Industry key', optional: true },
            InternationalLocationNumber1: {
              type: 'string',
              description: 'International location number, part 1',
              optional: true,
            },
            InternationalLocationNumber2: {
              type: 'string',
              description: 'International location number, part 2',
              optional: true,
            },
            InternationalLocationNumber3: {
              type: 'string',
              description: 'International location number, part 3',
              optional: true,
            },
            IsNaturalPerson: {
              type: 'boolean',
              description: 'Indicates whether the supplier is a natural person',
              optional: true,
            },
            PaymentIsBlockedForSupplier: {
              type: 'boolean',
              description: 'Payment block flag',
              optional: true,
            },
            PostingIsBlocked: {
              type: 'boolean',
              description: 'Posting block flag',
              optional: true,
            },
            PurchasingIsBlocked: {
              type: 'boolean',
              description: 'Purchasing block flag',
              optional: true,
            },
            ResponsibleType: {
              type: 'string',
              description: 'Type of business (Brazil)',
              optional: true,
            },
            SupplierAccountGroup: {
              type: 'string',
              description: 'Supplier account group',
              optional: true,
            },
            SupplierCorporateGroup: {
              type: 'string',
              description: 'Corporate group identifier',
              optional: true,
            },
            SupplierFullName: {
              type: 'string',
              description: 'Full name of the supplier',
              optional: true,
            },
            SupplierName: { type: 'string', description: 'Supplier name', optional: true },
            SupplierProcurementBlock: {
              type: 'string',
              description: 'Procurement block at supplier level',
              optional: true,
            },
            SuplrProofOfDelivRlvtCode: {
              type: 'string',
              description: 'Proof of delivery relevance code',
              optional: true,
            },
            SuplrQltyInProcmtCertfnValidTo: {
              type: 'string',
              description: 'Quality certification validity end date (OData v2 epoch)',
              optional: true,
            },
            SuplrQualityManagementSystem: {
              type: 'string',
              description: 'Quality management system of the supplier',
              optional: true,
            },
            TaxNumber1: { type: 'string', description: 'Tax number 1', optional: true },
            TaxNumber2: { type: 'string', description: 'Tax number 2', optional: true },
            TaxNumber3: { type: 'string', description: 'Tax number 3', optional: true },
            TaxNumber4: { type: 'string', description: 'Tax number 4', optional: true },
            TaxNumber5: { type: 'string', description: 'Tax number 5', optional: true },
            TaxNumberResponsible: {
              type: 'string',
              description: 'Tax number of responsible party',
              optional: true,
            },
            TaxNumberType: { type: 'string', description: 'Tax number type', optional: true },
            VATRegistration: {
              type: 'string',
              description: 'VAT registration number',
              optional: true,
            },
          },
        },
      },
    },
  },
}
