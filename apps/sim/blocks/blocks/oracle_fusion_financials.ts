import { NetSuiteIcon } from '@/components/icons'
import type { BlockConfig, BlockMeta } from '@/blocks/types'
import { AuthMode, IntegrationType } from '@/blocks/types'
import { parseOptionalBooleanInput, parseOptionalNumberInput } from '@/blocks/utils'

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') throw new Error(`${label} must be a string`)
  const normalized = value.trim()
  return normalized || undefined
}

export const OracleFusionFinancialsBlock: BlockConfig = {
  type: 'oracle_fusion_financials',
  name: 'Oracle Fusion Cloud Financials',
  description:
    'Read Oracle Fusion Payables invoices, distributions, prepayments, holds, payments, and terms',
  longDescription:
    'Connect a reusable Oracle Fusion Cloud Financials service account with a Fusion application URL, username, and password for Basic authentication. Read bounded pages and individual Payables invoices, lines, distributions, installments, prepayments, holds, payments, paid invoices, payment process requests, and payment terms without exposing write operations, arbitrary expansions, or opaque credential secrets.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_financials',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: NetSuiteIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Cloud Financials',
    sentences: {
      byOperation: {
        oracle_fusion_financials_list_payables_invoices: [
          'List Payables invoices',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_payables_invoice: [
          {
            text: 'Read Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_invoice_lines: [
          {
            text: 'List lines for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'lines' },
        ],
        oracle_fusion_financials_get_payables_invoice_line: [
          {
            text: 'Read line',
            field: 'invoiceLineUniqId',
            core: true,
          },
          {
            text: 'from Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_invoice_installments: [
          {
            text: 'List installments for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'installments' },
        ],
        oracle_fusion_financials_get_payables_invoice_installment: [
          {
            text: 'Read installment',
            field: 'invoiceInstallmentUniqId',
            core: true,
          },
          {
            text: 'from Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_invoice_distributions: [
          {
            text: 'List distributions for line',
            field: 'invoiceLineUniqId',
            core: true,
          },
          {
            text: 'of Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_invoice_distribution: [
          {
            text: 'Read distribution',
            field: 'invoiceDistributionId',
            core: true,
          },
          { text: 'for line', field: 'invoiceLineUniqId', core: true },
          {
            text: 'of Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_applied_prepayments: [
          {
            text: 'List applied prepayments for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_applied_prepayment: [
          {
            text: 'Read applied prepayment',
            field: 'appliedPrepaymentUniqId',
            core: true,
          },
          {
            text: 'for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_available_prepayments: [
          {
            text: 'List available prepayments for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_available_prepayment: [
          {
            text: 'Read available prepayment',
            field: 'availablePrepaymentUniqId',
            core: true,
          },
          {
            text: 'for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_payments: [
          'List Payables payments',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
          { text: ', up to', field: 'limit', after: 'records' },
        ],
        oracle_fusion_financials_get_payables_payment: [
          { text: 'Read Payables payment', field: 'checkId', core: true },
        ],
        oracle_fusion_financials_list_payables_payment_related_invoices: [
          { text: 'List invoices paid by payment', field: 'checkId', core: true },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_payment_related_invoice: [
          { text: 'Read paid invoice', field: 'invoicePaymentId', core: true },
          { text: 'for payment', field: 'checkId', core: true },
        ],
        oracle_fusion_financials_list_payment_process_requests: [
          'List payment process requests',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
        ],
        oracle_fusion_financials_get_payment_process_request: [
          {
            text: 'Read payment process request',
            field: 'paymentProcessRequestId',
            core: true,
          },
        ],
        oracle_fusion_financials_list_payables_invoice_holds: [
          'List Payables invoice holds',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
        ],
        oracle_fusion_financials_get_payables_invoice_hold: [
          { text: 'Read Payables invoice hold', field: 'holdId', core: true },
        ],
        oracle_fusion_financials_list_payables_payment_terms: [
          'List Payables payment terms',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
        ],
        oracle_fusion_financials_get_payables_payment_term: [
          { text: 'Read Payables payment term', field: 'termsId', core: true },
        ],
        oracle_fusion_financials_list_payables_payment_term_lines: [
          { text: 'List calculation lines for payment term', field: 'termsId', core: true },
          { text: ', matching', field: 'q' },
        ],
        oracle_fusion_financials_get_payables_payment_term_line: [
          {
            text: 'Read calculation line',
            field: 'paymentTermLineUniqId',
            core: true,
          },
          { text: 'for payment term', field: 'termsId', core: true },
        ],
      },
    },
  },
  subBlocks: [
    {
      id: 'credential',
      title: 'Oracle Fusion Account',
      type: 'oauth-input',
      serviceId: 'oracle_fusion_financials',
      credentialKind: 'service-account',
      canonicalParamId: 'oauthCredential',
      mode: 'basic',
      placeholder: 'Select Oracle Fusion credential',
      required: true,
    },
    {
      id: 'manualCredential',
      title: 'Oracle Fusion Account',
      type: 'short-input',
      canonicalParamId: 'oauthCredential',
      mode: 'advanced',
      placeholder: 'Enter credential ID',
      required: true,
    },
    {
      id: 'operation',
      title: 'Operation',
      type: 'dropdown',
      options: [
        {
          label: 'List Payables Invoices',
          id: 'oracle_fusion_financials_list_payables_invoices',
        },
        {
          label: 'Get Payables Invoice',
          id: 'oracle_fusion_financials_get_payables_invoice',
        },
        {
          label: 'List Payables Invoice Lines',
          id: 'oracle_fusion_financials_list_payables_invoice_lines',
        },
        {
          label: 'Get Payables Invoice Line',
          id: 'oracle_fusion_financials_get_payables_invoice_line',
        },
        {
          label: 'List Payables Invoice Installments',
          id: 'oracle_fusion_financials_list_payables_invoice_installments',
        },
        {
          label: 'Get Payables Invoice Installment',
          id: 'oracle_fusion_financials_get_payables_invoice_installment',
        },
        {
          label: 'List Payables Invoice Distributions',
          id: 'oracle_fusion_financials_list_payables_invoice_distributions',
        },
        {
          label: 'Get Payables Invoice Distribution',
          id: 'oracle_fusion_financials_get_payables_invoice_distribution',
        },
        {
          label: 'List Payables Applied Prepayments',
          id: 'oracle_fusion_financials_list_payables_applied_prepayments',
        },
        {
          label: 'Get Payables Applied Prepayment',
          id: 'oracle_fusion_financials_get_payables_applied_prepayment',
        },
        {
          label: 'List Payables Available Prepayments',
          id: 'oracle_fusion_financials_list_payables_available_prepayments',
        },
        {
          label: 'Get Payables Available Prepayment',
          id: 'oracle_fusion_financials_get_payables_available_prepayment',
        },
        {
          label: 'List Payables Payments',
          id: 'oracle_fusion_financials_list_payables_payments',
        },
        {
          label: 'Get Payables Payment',
          id: 'oracle_fusion_financials_get_payables_payment',
        },
        {
          label: 'List Payment-Related Invoices',
          id: 'oracle_fusion_financials_list_payables_payment_related_invoices',
        },
        {
          label: 'Get Payment-Related Invoice',
          id: 'oracle_fusion_financials_get_payables_payment_related_invoice',
        },
        {
          label: 'List Payment Process Requests',
          id: 'oracle_fusion_financials_list_payment_process_requests',
        },
        {
          label: 'Get Payment Process Request',
          id: 'oracle_fusion_financials_get_payment_process_request',
        },
        {
          label: 'List Payables Invoice Holds',
          id: 'oracle_fusion_financials_list_payables_invoice_holds',
        },
        {
          label: 'Get Payables Invoice Hold',
          id: 'oracle_fusion_financials_get_payables_invoice_hold',
        },
        {
          label: 'List Payables Payment Terms',
          id: 'oracle_fusion_financials_list_payables_payment_terms',
        },
        {
          label: 'Get Payables Payment Term',
          id: 'oracle_fusion_financials_get_payables_payment_term',
        },
        {
          label: 'List Payables Payment Term Lines',
          id: 'oracle_fusion_financials_list_payables_payment_term_lines',
        },
        {
          label: 'Get Payables Payment Term Line',
          id: 'oracle_fusion_financials_get_payables_payment_term_line',
        },
      ],
      value: () => 'oracle_fusion_financials_list_payables_invoices',
      required: true,
    },
    {
      id: 'invoiceSelector',
      title: 'Payables Invoice',
      type: 'project-selector',
      canonicalParamId: 'invoiceUniqId',
      serviceId: 'oracle_fusion_financials',
      selectorKey: 'oracleFusionFinancials.invoices',
      dependsOn: ['credential'],
      mode: 'basic',
      placeholder: 'Select a recent invoice',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_get_payables_invoice_installment',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_get_payables_applied_prepayment',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_get_payables_available_prepayment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_get_payables_invoice_installment',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_get_payables_applied_prepayment',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_get_payables_available_prepayment',
        ],
      },
    },
    {
      id: 'invoiceUniqIdManual',
      title: 'Payables Invoice Key',
      type: 'short-input',
      canonicalParamId: 'invoiceUniqId',
      mode: 'advanced',
      placeholder: 'Opaque key returned by Oracle Fusion',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_get_payables_invoice_installment',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_get_payables_applied_prepayment',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_get_payables_available_prepayment',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_get_payables_invoice_installment',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_get_payables_applied_prepayment',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_get_payables_available_prepayment',
        ],
      },
    },
    {
      id: 'invoiceLineUniqId',
      title: 'Invoice Line Key',
      type: 'short-input',
      placeholder: 'Opaque invoice-line key returned by Oracle',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice_line',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_get_payables_invoice_distribution',
        ],
      },
    },
    {
      id: 'invoiceInstallmentUniqId',
      title: 'Invoice Installment Key',
      type: 'short-input',
      placeholder: 'Opaque invoice-installment key returned by Oracle',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_installment',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_installment',
      },
    },
    {
      id: 'invoiceDistributionId',
      title: 'Invoice Distribution ID',
      type: 'short-input',
      placeholder: 'Oracle InvoiceDistributionId',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_distribution',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_distribution',
      },
    },
    {
      id: 'appliedPrepaymentUniqId',
      title: 'Applied Prepayment Key',
      type: 'short-input',
      placeholder: 'Opaque applied-prepayment key returned by Oracle',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_applied_prepayment',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_applied_prepayment',
      },
    },
    {
      id: 'availablePrepaymentUniqId',
      title: 'Available Prepayment Key',
      type: 'short-input',
      placeholder: 'Opaque available-prepayment key returned by Oracle',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_available_prepayment',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_available_prepayment',
      },
    },
    {
      id: 'checkId',
      title: 'Payment Check ID',
      type: 'short-input',
      placeholder: 'Oracle payment CheckId',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_payment',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_get_payables_payment_related_invoice',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_payment',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_get_payables_payment_related_invoice',
        ],
      },
    },
    {
      id: 'invoicePaymentId',
      title: 'Invoice Payment ID',
      type: 'short-input',
      placeholder: 'Oracle InvoicePaymentId',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment_related_invoice',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment_related_invoice',
      },
    },
    {
      id: 'paymentProcessRequestId',
      title: 'Payment Process Request ID',
      type: 'short-input',
      placeholder: 'Oracle PaymentProcessRequestId',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payment_process_request',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payment_process_request',
      },
    },
    {
      id: 'holdId',
      title: 'Invoice Hold ID',
      type: 'short-input',
      placeholder: 'Oracle HoldId',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_hold',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_invoice_hold',
      },
    },
    {
      id: 'termsId',
      title: 'Payment Term ID',
      type: 'short-input',
      placeholder: 'Oracle termsId',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_payment_term',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_get_payables_payment_term_line',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_payment_term',
          'oracle_fusion_financials_list_payables_payment_term_lines',
          'oracle_fusion_financials_get_payables_payment_term_line',
        ],
      },
    },
    {
      id: 'paymentTermLineUniqId',
      title: 'Payment Term Line Key',
      type: 'short-input',
      placeholder: 'Opaque payment-term-line key returned by Oracle',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment_term_line',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment_term_line',
      },
    },
    {
      id: 'q',
      title: 'Filter',
      type: 'long-input',
      placeholder: 'Oracle REST Framework q expression',
      wandConfig: {
        enabled: true,
        prompt: `Generate an Oracle Fusion Cloud Financials REST Framework q filter from the user's request.

Rules:
- Use only queryable attributes documented by Oracle for the selected Payables collection
- Preserve Oracle attribute capitalization
- Follow Oracle's expression syntax, such as AmountPaid=0;InvoiceDate>=2026-01-01
- Separate multiple expressions with semicolons
- Do not include a leading q=, URL encoding, fields, expand, or explanatory text

Return ONLY the q filter expression - no explanations or extra text.`,
        placeholder: 'Describe the Payables records to filter',
      },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
        ],
      },
    },
    {
      id: 'finder',
      title: 'Finder',
      type: 'long-input',
      placeholder: 'FinderName;Variable=Value',
      wandConfig: {
        enabled: true,
        prompt: `Generate an Oracle Fusion Cloud Financials predefined finder expression from the user's request.

Use only these Oracle-documented finders for the selected operation:
- Invoices: PrimaryKey;InvoiceId=<integer>
- Invoice lines: PrimaryKey;LineNumber=<integer>
- Invoice installments: PrimaryKey;InstallmentNumber=<integer>
- Payments: PaidInvoicesFinder;InvoiceNumber=<string> or PrimaryKey;CheckId=<integer>
- Payment-related invoices: PrimaryKey;InvoicePaymentId=<integer>

For every other collection, use a finder only when the selected endpoint's Oracle documentation explicitly lists its name and variables.

Use exactly one finder and its documented variable. Do not invent finder names or variables, include a leading finder=, URL-encode the value, or add explanatory text.

Return ONLY the finder expression - no explanations or extra text.`,
        placeholder: 'Describe the documented finder and value to use',
      },
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
        ],
      },
    },
    {
      id: 'orderBy',
      title: 'Order By',
      type: 'short-input',
      placeholder: 'InvoiceDate:desc',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
        ],
      },
    },
    {
      id: 'effectiveDate',
      title: 'Effective Date',
      type: 'short-input',
      placeholder: 'YYYY-MM-DD',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_list_payables_invoices',
      },
    },
    {
      id: 'limit',
      title: 'Limit',
      type: 'short-input',
      placeholder: '50 (maximum 100)',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
        ],
      },
    },
    {
      id: 'offset',
      title: 'Offset',
      type: 'short-input',
      placeholder: '0',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
        ],
      },
    },
    {
      id: 'totalResults',
      title: 'Include Total Results',
      type: 'dropdown',
      options: [
        { label: 'Default', id: '' },
        { label: 'Yes', id: 'true' },
        { label: 'No', id: 'false' },
      ],
      value: () => '',
      mode: 'advanced',
      condition: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_list_payables_invoices',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
          'oracle_fusion_financials_list_payables_invoice_distributions',
          'oracle_fusion_financials_list_payables_applied_prepayments',
          'oracle_fusion_financials_list_payables_available_prepayments',
          'oracle_fusion_financials_list_payables_payments',
          'oracle_fusion_financials_list_payables_payment_related_invoices',
          'oracle_fusion_financials_list_payment_process_requests',
          'oracle_fusion_financials_list_payables_invoice_holds',
          'oracle_fusion_financials_list_payables_payment_terms',
          'oracle_fusion_financials_list_payables_payment_term_lines',
        ],
      },
    },
  ],
  tools: {
    access: [
      'oracle_fusion_financials_list_payables_invoices',
      'oracle_fusion_financials_get_payables_invoice',
      'oracle_fusion_financials_list_payables_invoice_lines',
      'oracle_fusion_financials_get_payables_invoice_line',
      'oracle_fusion_financials_list_payables_invoice_installments',
      'oracle_fusion_financials_get_payables_invoice_installment',
      'oracle_fusion_financials_list_payables_invoice_distributions',
      'oracle_fusion_financials_get_payables_invoice_distribution',
      'oracle_fusion_financials_list_payables_applied_prepayments',
      'oracle_fusion_financials_get_payables_applied_prepayment',
      'oracle_fusion_financials_list_payables_available_prepayments',
      'oracle_fusion_financials_get_payables_available_prepayment',
      'oracle_fusion_financials_list_payables_payments',
      'oracle_fusion_financials_get_payables_payment',
      'oracle_fusion_financials_list_payables_payment_related_invoices',
      'oracle_fusion_financials_get_payables_payment_related_invoice',
      'oracle_fusion_financials_list_payment_process_requests',
      'oracle_fusion_financials_get_payment_process_request',
      'oracle_fusion_financials_list_payables_invoice_holds',
      'oracle_fusion_financials_get_payables_invoice_hold',
      'oracle_fusion_financials_list_payables_payment_terms',
      'oracle_fusion_financials_get_payables_payment_term',
      'oracle_fusion_financials_list_payables_payment_term_lines',
      'oracle_fusion_financials_get_payables_payment_term_line',
    ],
    config: {
      tool: (params) => params.operation,
      params: (params) => {
        const { operation: _operation, ...rest } = params
        return {
          ...rest,
          q: optionalString(rest.q, 'Filter'),
          finder: optionalString(rest.finder, 'Finder'),
          orderBy: optionalString(rest.orderBy, 'Order By'),
          effectiveDate: optionalString(rest.effectiveDate, 'Effective Date'),
          limit: parseOptionalNumberInput(rest.limit, 'Limit', {
            integer: true,
            min: 1,
            max: 100,
          }),
          offset: parseOptionalNumberInput(rest.offset, 'Offset', { integer: true, min: 0 }),
          totalResults: parseOptionalBooleanInput(rest.totalResults),
        }
      },
    },
  },
  inputs: {
    operation: { type: 'string', description: 'Oracle Fusion Financials operation to perform' },
    oauthCredential: {
      type: 'string',
      description: 'Oracle Fusion service-account credential',
    },
    invoiceUniqId: {
      type: 'string',
      description: 'Opaque invoice key returned by Oracle Fusion',
    },
    invoiceLineUniqId: {
      type: 'string',
      description: 'Opaque invoice-line key returned by Oracle Fusion',
    },
    invoiceInstallmentUniqId: {
      type: 'string',
      description: 'Opaque invoice-installment key returned by Oracle Fusion',
    },
    invoiceDistributionId: {
      type: 'string',
      description: 'Oracle InvoiceDistributionId as a decimal string',
    },
    appliedPrepaymentUniqId: {
      type: 'string',
      description: 'Opaque applied-prepayment key returned by Oracle Fusion',
    },
    availablePrepaymentUniqId: {
      type: 'string',
      description: 'Opaque available-prepayment key returned by Oracle Fusion',
    },
    checkId: { type: 'string', description: 'Oracle payment CheckId as a decimal string' },
    invoicePaymentId: {
      type: 'string',
      description: 'Oracle InvoicePaymentId as a decimal string',
    },
    paymentProcessRequestId: {
      type: 'string',
      description: 'Oracle PaymentProcessRequestId as a decimal string',
    },
    holdId: { type: 'string', description: 'Oracle HoldId as a decimal string' },
    termsId: { type: 'string', description: 'Oracle termsId as a decimal string' },
    paymentTermLineUniqId: {
      type: 'string',
      description: 'Opaque payment-term-line key returned by Oracle Fusion',
    },
    q: { type: 'string', description: 'Oracle REST Framework q filter expression' },
    finder: { type: 'string', description: 'Oracle predefined finder expression' },
    orderBy: { type: 'string', description: 'Oracle attribute ordering expression' },
    effectiveDate: { type: 'string', description: 'Invoice effective date in YYYY-MM-DD form' },
    limit: { type: 'number', description: 'Page size from 1 to 100' },
    offset: { type: 'number', description: 'Non-negative page offset' },
    totalResults: { type: 'boolean', description: 'Request Oracle total-results metadata' },
  },
  outputs: {
    items: {
      type: 'array',
      description: 'Projected Oracle Fusion Payables resources in this page',
    },
    count: { type: 'number', description: 'Number of records in this page' },
    hasMore: { type: 'boolean', description: 'Whether Oracle has another page' },
    limit: { type: 'number', description: 'Page size returned by Oracle' },
    offset: { type: 'number', description: 'Offset returned by Oracle' },
    totalResults: {
      type: 'number',
      description: 'Estimated total matching records when requested',
    },
    invoice: {
      type: 'json',
      description:
        'Projected Payables invoice with an invoiceUniqId string and nullable number/string scalars for identity, supplier and site, business unit, amount and currency, invoice and accounting dates, payment and workflow statuses, terms, method, purchase order, description, and creation/update dates',
    },
    payment: {
      type: 'json',
      description:
        'Projected Payables payment with nullable number, string, and boolean scalars for check/payment identity, reference, amount and currency, payment/accounting dates, payee and supplier, method/status/type, business unit, legal entity, reconciliation flag, and creation/update dates',
    },
    invoiceLine: {
      type: 'json',
      description:
        'Projected invoice line with its Oracle-derived opaque key, amounts, accounting flags, purchase-order and receipt references, item, tax, location, and timestamps',
    },
    invoiceInstallment: {
      type: 'json',
      description:
        'Projected invoice installment with its Oracle-derived opaque key, due and unpaid amounts, payment method and priority, hold state, discounts, and timestamps',
    },
    invoiceDistribution: {
      type: 'json',
      description:
        'Projected invoice distribution with identity, amounts, account combination, accounting, match and funds status, reversal and cancellation flags, document references, tax, asset state, and timestamps',
    },
    appliedPrepayment: {
      type: 'json',
      description:
        'Projected applied prepayment with its Oracle-derived opaque key, invoice and line identity, supplier site, currency, amount, tax, application date, and inclusion flag',
    },
    availablePrepayment: {
      type: 'json',
      description:
        'Projected available prepayment with its Oracle-derived opaque key, invoice and line identity, supplier site, currency, available amount, and tax',
    },
    paymentRelatedInvoice: {
      type: 'json',
      description:
        'Projected invoice related to a payment with payment, invoice and installment identity, business unit, currencies, amounts, discounts, exchange rate, status, and timestamps',
    },
    invoiceHold: {
      type: 'json',
      description:
        'Projected Payables invoice hold with invoice, supplier and business-unit context, hold and release details, workflow state, document references, and timestamps',
    },
    paymentProcessRequest: {
      type: 'json',
      description:
        'Projected payment process request with identifier, name, source application, status code, and status meaning',
    },
    paymentTerm: {
      type: 'json',
      description:
        'Projected Payables payment term with identity, name, description, enabled and effective state, cutoff, ranking, reference set, and timestamps',
    },
    paymentTermLine: {
      type: 'json',
      description:
        'Projected payment-term calculation line with its Oracle-derived opaque key, due-date calculation values, and three discount tiers',
    },
  },
}

export const OracleFusionFinancialsBlockMeta = {
  tags: ['automation', 'data-analytics', 'payments'],
  url: 'https://www.oracle.com/erp/financials/',
  templates: [
    {
      icon: NetSuiteIcon,
      title: 'Find overdue Payables invoices',
      prompt:
        'Build a scheduled workflow that lists unpaid Oracle Fusion Payables invoices, reviews their installments for due dates before today, and sends a concise overdue-invoice report without fetching additional pages automatically.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Report unpaid invoice aging',
      prompt:
        'Create a workflow that reads one bounded page of unpaid Oracle Fusion Payables invoices, groups amounts into aging buckets from invoice and installment dates, and writes the summary to a table.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor invoice approval exceptions',
      prompt:
        'Build a scheduled Oracle Fusion workflow that lists Payables invoices with exceptional approval status and sends finance a report containing invoice number, supplier, amount, currency, and status.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor invoice validation exceptions',
      prompt:
        'Build a scheduled workflow that lists Oracle Fusion Payables invoices with validation exceptions and records their identifiers, suppliers, amounts, and validation status for investigation.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Audit Payables invoice lines',
      prompt:
        'Create a workflow that selects an Oracle Fusion Payables invoice, reads its invoice lines and accounting distributions, and reports line amounts, account combinations, match and funds status, purchase-order and receipt references, tax, and reversal state.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Track upcoming payment installments',
      prompt:
        'Create a scheduled workflow that reviews Oracle Fusion Payables invoice installments due in the coming week, reads payment term calculation lines when the termsId is known, and sends a treasury digest with unpaid amount, due date, discounts, payment method, priority, and hold state.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'payments'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Reconcile recent Payables payments',
      prompt:
        'Build a scheduled workflow that lists one page of recent Oracle Fusion Payables payments, traces each selected payment to its related invoices, checks a payment process request when its identifier is known, and writes a reconciliation report with identifiers, dates, amounts, and status.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'payments'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Create a supplier payment report',
      prompt:
        'Create a workflow that lists Oracle Fusion Payables payments for a specified reporting period and produces a supplier-level report using payee, supplier number, amount, currency, method, status, and payment date.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Investigate Payables invoice holds',
      prompt:
        'Build a workflow that lists active Oracle Fusion Payables invoice holds, reads selected hold details, and produces an investigation queue with supplier, invoice, hold reason, workflow status, purchase-order or receipt context, and release history.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Analyze invoice prepayment coverage',
      prompt:
        'Create a workflow that selects a Payables invoice, compares its applied and available prepayments, and reports currency, applied or available amounts, included tax, supplier site, and application date without applying or unapplying anything.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'payments'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Monitor payment process requests',
      prompt:
        'Create a scheduled workflow that lists recent Oracle Fusion payment process requests, highlights incomplete or exceptional status codes, and sends treasury a concise payment-run status report.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: NetSuiteIcon,
      title: 'Analyze terms-based payment schedules',
      prompt:
        'Build a workflow that reads a Payables payment term and its calculation lines, compares due-date and three-tier discount rules with a selected invoice installment, and reports schedule discrepancies for review.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
  ],
  skills: [
    {
      name: 'find-unpaid-oracle-fusion-invoices',
      description: 'Find unpaid Oracle Fusion Payables invoices in a bounded result page.',
      content:
        '# Find Unpaid Oracle Fusion Invoices\n\n## Steps\n\n1. Use List Payables Invoices with the narrowest verified q filter for unpaid status.\n2. Request only one page, with limit no greater than 100.\n3. Use the returned invoiceUniqId when a specific invoice needs more detail.\n\n## Output\n\nReturn invoice number, supplier, amount, currency, invoice date, paid status, and whether Oracle reports another page.',
    },
    {
      name: 'inspect-oracle-fusion-invoice-lines',
      description: 'Inspect the fixed, read-only line projection for a Payables invoice.',
      content:
        '# Inspect Oracle Fusion Invoice Lines\n\n## Steps\n\n1. Select the invoice or use an invoiceUniqId returned by Oracle.\n2. Use List Payables Invoice Lines with a page limit no greater than 100.\n3. Review amounts, accounting flags, purchase-order and receipt references, item fields, tax fields, and locations.\n\n## Output\n\nReport the invoice key, relevant line numbers, findings, and whether another page remains.',
    },
    {
      name: 'audit-oracle-fusion-invoice-distributions',
      description: 'Audit accounting distributions and matching state for a Payables invoice line.',
      content:
        '# Audit Oracle Fusion Invoice Distributions\n\n## Steps\n\n1. Select an invoice and list its invoice lines to obtain an Oracle-derived invoiceLineUniqId.\n2. Use List Payables Invoice Distributions with a page limit no greater than 100.\n3. Review account combinations, amounts, accounting, match and funds status, reversal and cancellation flags, and purchase-order, receipt, prepayment, tax, and asset references.\n4. Use Get Payables Invoice Distribution with the decimal InvoiceDistributionId for one selected record.\n\n## Output\n\nReport the invoice and line keys, distribution identifiers, accounting exceptions, and whether another page remains.',
    },
    {
      name: 'review-oracle-fusion-payment-schedules',
      description: 'Review due dates, unpaid amounts, discounts, and holds for an invoice.',
      content:
        '# Review Oracle Fusion Payment Schedules\n\n## Steps\n\n1. Select the invoice or provide its Oracle-derived opaque key.\n2. Use List Payables Invoice Installments for one bounded page and Get Payables Invoice Installment when one schedule needs detail.\n3. Read the applicable Payables Payment Term and its term lines when the termsId is known.\n4. Compare due date, unpaid amount, payment priority, hold state, discount dates and amounts, and the documented due and discount calculation values.\n\n## Output\n\nSummarize upcoming obligations and any schedule discrepancy without guessing unavailable term mappings.',
    },
    {
      name: 'trace-oracle-fusion-invoice-payment-status',
      description: 'Trace the read-only payment state exposed on a Payables invoice.',
      content:
        '# Trace Oracle Fusion Invoice Payment Status\n\n## Steps\n\n1. Use Get Payables Invoice with an invoiceUniqId obtained from Oracle.\n2. Review amount, amount paid, paid status, approval status, validation status, method, and terms.\n3. If schedule timing matters, list the invoice installments separately.\n\n## Output\n\nState the invoice payment state and supporting fields; do not infer a payment-to-invoice link that Oracle did not return.',
    },
    {
      name: 'reconcile-recent-oracle-fusion-payments',
      description: 'Review recent Payables payments and isolate reconciliation exceptions.',
      content:
        '# Reconcile Recent Oracle Fusion Payments\n\n## Steps\n\n1. Use List Payables Payments ordered by PaymentDate descending with one bounded page.\n2. Review CheckId, payment references, amount, currency, date, status, and ReconciledFlag.\n3. For selected payments, list related invoices and inspect the relevant payment process request when its identifier is known.\n4. Use Get Payables Payment or Get Payment-Related Invoice for a specific record.\n\n## Output\n\nReport reconciled and unreconciled payments, related invoice amounts and discounts, payment-run status, and whether another page remains.',
    },
    {
      name: 'investigate-oracle-fusion-invoice-holds',
      description: 'Investigate Payables invoice holds and their release workflow state.',
      content:
        '# Investigate Oracle Fusion Invoice Holds\n\n## Steps\n\n1. Use List Payables Invoice Holds with the narrowest documented q filter and a page limit no greater than 100.\n2. Review invoice, supplier, business unit, line, hold reason, workflow status, purchase-order, and receipt context.\n3. Use Get Payables Invoice Hold with the decimal HoldId to inspect release details and timestamps.\n\n## Output\n\nReturn a prioritized hold queue with evidence from Oracle and state whether another page remains.',
    },
    {
      name: 'trace-oracle-fusion-payment-applications',
      description: 'Trace a Payables payment to invoices and prepayment activity.',
      content:
        '# Trace Oracle Fusion Payment Applications\n\n## Steps\n\n1. Use Get Payables Payment with its decimal CheckId.\n2. Use List Payment-Related Invoices for that payment and inspect selected InvoicePaymentId records.\n3. For a selected invoice, compare applied and available prepayments using only Oracle-derived opaque keys.\n4. Review invoice and payment currencies, paid amounts, discounts, exchange rate, payment status, and application accounting date.\n\n## Output\n\nProvide a read-only trace from payment to invoice applications and clearly identify any pagination boundary or unavailable linkage.',
    },
  ],
} as const satisfies BlockMeta
