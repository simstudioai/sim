import type { ListSupplierInvoicesParams, SapProxyResponse } from '@/tools/sap_s4hana/types'
import {
  baseProxyBody,
  buildOdataQuery,
  SAP_PROXY_URL,
  transformSapProxyResponse,
} from '@/tools/sap_s4hana/utils'
import type { ToolConfig } from '@/tools/types'

export const listSupplierInvoicesTool: ToolConfig<ListSupplierInvoicesParams, SapProxyResponse> = {
  id: 'sap_s4hana_list_supplier_invoices',
  name: 'SAP S/4HANA List Supplier Invoices',
  description:
    'List supplier invoices from SAP S/4HANA Cloud (API_SUPPLIERINVOICE_PROCESS_SRV, A_SupplierInvoice) with optional OData $filter, $top, $skip, $orderby, $select, $expand.',
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
      description: 'OData $filter expression (e.g., "InvoicingParty eq \'17300001\'")',
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
      service: 'API_SUPPLIERINVOICE_PROCESS_SRV',
      path: '/A_SupplierInvoice',
      method: 'GET',
      query: buildOdataQuery(params),
    }),
  },
  transformResponse: transformSapProxyResponse,
  outputs: {
    status: { type: 'number', description: 'HTTP status code returned by SAP' },
    data: {
      type: 'json',
      description: 'OData v2 response envelope; collection at output.data.d.results',
      properties: {
        d: {
          type: 'json',
          description: 'OData v2 envelope',
          properties: {
            results: {
              type: 'array',
              description: 'A_SupplierInvoice entities',
              items: {
                type: 'object',
                properties: {
                  SupplierInvoice: { type: 'string', description: 'Supplier invoice number' },
                  FiscalYear: { type: 'string', description: 'Fiscal year' },
                  CompanyCode: { type: 'string', description: 'Company code' },
                  DocumentDate: {
                    type: 'string',
                    description: 'Invoice document date',
                    optional: true,
                  },
                  PostingDate: {
                    type: 'string',
                    description: 'Posting date',
                    optional: true,
                  },
                  InvoicingParty: {
                    type: 'string',
                    description: 'Invoicing party (supplier key)',
                    optional: true,
                  },
                  InvoiceGrossAmount: {
                    type: 'string',
                    description: 'Gross invoice amount',
                    optional: true,
                  },
                  DocumentCurrency: {
                    type: 'string',
                    description: 'Document currency',
                    optional: true,
                  },
                  AccountingDocumentType: {
                    type: 'string',
                    description: 'Accounting document type',
                    optional: true,
                  },
                  PaymentTerms: {
                    type: 'string',
                    description: 'Payment terms key',
                    optional: true,
                  },
                  DueCalculationBaseDate: {
                    type: 'string',
                    description: 'Baseline date for due-date calculation',
                    optional: true,
                  },
                  SupplierInvoiceIDByInvcgParty: {
                    type: 'string',
                    description: 'Reference number used by the invoicing party',
                    optional: true,
                  },
                  PaymentMethod: {
                    type: 'string',
                    description: 'Payment method',
                    optional: true,
                  },
                  TaxIsCalculatedAutomatically: {
                    type: 'boolean',
                    description: 'Whether tax is calculated automatically',
                    optional: true,
                  },
                  ManualCashDiscount: {
                    type: 'string',
                    description: 'Manually entered cash discount amount',
                    optional: true,
                  },
                  BusinessPlace: {
                    type: 'string',
                    description: 'Business place (jurisdiction code)',
                    optional: true,
                  },
                },
              },
            },
            __next: {
              type: 'string',
              description: 'OData skiptoken URL for next page',
              optional: true,
            },
          },
        },
      },
    },
  },
}
