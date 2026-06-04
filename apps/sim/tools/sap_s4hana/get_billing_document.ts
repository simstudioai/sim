import type { GetBillingDocumentParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildEntityQuery,
  quoteOdataKey,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const getBillingDocumentTool: ToolConfig<GetBillingDocumentParams, SapProxyResponse> = {
  id: 'sap_s4hana_get_billing_document',
  name: 'SAP S/4HANA Get Billing Document',
  description:
    'Retrieve a single billing document (customer invoice) by BillingDocument key from SAP S/4HANA Cloud (API_BILLING_DOCUMENT_SRV, A_BillingDocument).',
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
    billingDocument: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'BillingDocument key (string, up to 10 characters)',
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
        'Comma-separated navigation properties to expand (e.g., "to_Item,to_Partner,to_PricingElement")',
    },
  },
  request: {
    url: SAP_PROXY_URL,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      ...baseProxyBody(params),
      service: 'API_BILLING_DOCUMENT_SRV',
      path: `/A_BillingDocument(${quoteOdataKey(params.billingDocument)})`,
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
          description: 'A_BillingDocument entity',
          properties: {
            BillingDocument: { type: 'string', description: 'Billing document number' },
            SDDocumentCategory: {
              type: 'string',
              description: 'SD document category',
              optional: true,
            },
            BillingDocumentCategory: {
              type: 'string',
              description: 'Billing document category',
              optional: true,
            },
            BillingDocumentType: {
              type: 'string',
              description: 'Billing document type',
              optional: true,
            },
            BillingDocumentDate: {
              type: 'string',
              description: 'Billing document date (OData /Date(ms)/)',
              optional: true,
            },
            BillingDocumentIsCancelled: {
              type: 'boolean',
              description: 'Whether the billing document is cancelled',
              optional: true,
            },
            CancelledBillingDocument: {
              type: 'string',
              description: 'Cancelled billing document number',
              optional: true,
            },
            TotalNetAmount: {
              type: 'string',
              description: 'Total net amount (Edm.Decimal as string)',
              optional: true,
            },
            TaxAmount: {
              type: 'string',
              description: 'Tax amount (Edm.Decimal as string)',
              optional: true,
            },
            TotalGrossAmount: {
              type: 'string',
              description: 'Total gross amount (Edm.Decimal as string)',
              optional: true,
            },
            TransactionCurrency: {
              type: 'string',
              description: 'Document currency',
              optional: true,
            },
            SoldToParty: {
              type: 'string',
              description: 'Sold-to business partner',
              optional: true,
            },
            PayerParty: { type: 'string', description: 'Payer party', optional: true },
            SalesOrganization: {
              type: 'string',
              description: 'Sales organization',
              optional: true,
            },
            DistributionChannel: {
              type: 'string',
              description: 'Distribution channel',
              optional: true,
            },
            Division: { type: 'string', description: 'Division', optional: true },
            CompanyCode: { type: 'string', description: 'Company code', optional: true },
            FiscalYear: { type: 'string', description: 'Fiscal year', optional: true },
            OverallBillingStatus: {
              type: 'string',
              description: 'Overall billing status',
              optional: true,
            },
            AccountingPostingStatus: {
              type: 'string',
              description: 'Accounting posting status',
              optional: true,
            },
            AccountingTransferStatus: {
              type: 'string',
              description: 'Accounting transfer status',
              optional: true,
            },
            InvoiceClearingStatus: {
              type: 'string',
              description: 'Invoice clearing status',
              optional: true,
            },
            AccountingDocument: {
              type: 'string',
              description: 'Linked accounting document',
              optional: true,
            },
            CustomerPaymentTerms: {
              type: 'string',
              description: 'Customer payment terms',
              optional: true,
            },
            PaymentMethod: { type: 'string', description: 'Payment method', optional: true },
            DocumentReferenceID: {
              type: 'string',
              description: 'Document reference ID',
              optional: true,
            },
            CreationDate: {
              type: 'string',
              description: 'Creation date (OData /Date(ms)/)',
              optional: true,
            },
            LastChangeDate: {
              type: 'string',
              description: 'Last change date (OData /Date(ms)/)',
              optional: true,
            },
            LastChangeDateTime: {
              type: 'string',
              description: 'Last change date-time (Edm.DateTimeOffset)',
              optional: true,
            },
            to_Item: {
              type: 'json',
              description: 'Billing document items (when $expand=to_Item)',
              optional: true,
            },
            to_Partner: {
              type: 'json',
              description: 'Billing document partners (when $expand=to_Partner)',
              optional: true,
            },
            to_PricingElement: {
              type: 'json',
              description: 'Billing document pricing elements (when $expand=to_PricingElement)',
              optional: true,
            },
          },
        },
      },
    },
  },
}
