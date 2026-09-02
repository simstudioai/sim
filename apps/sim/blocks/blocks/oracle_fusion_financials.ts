import { OracleIcon } from '@/components/icons'
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
  description: 'Read Oracle Fusion Payables invoices, lines, installments, and payments',
  longDescription:
    'Connect a reusable Oracle Fusion Cloud Financials service account with OAuth 2.0 client credentials. Read bounded pages of Payables invoices, invoice lines, payment schedules, and payments without exposing write operations, arbitrary expansions, or opaque credential secrets.',
  docsLink: 'https://docs.sim.ai/integrations/oracle_fusion_financials',
  category: 'tools',
  integrationType: IntegrationType.Commerce,
  authMode: AuthMode.ApiKey,
  bgColor: '#FFFFFF',
  icon: OracleIcon,
  canvasPresentation: {
    defaultTitle: 'Oracle Fusion Cloud Financials',
    sentences: {
      byOperation: {
        oracle_fusion_financials_list_payables_invoices: [
          'List Payables invoices',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
          { text: ', up to', field: 'limit', after: 'records' },
          { text: ', starting at offset', field: 'offset' },
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
          { text: ', starting at offset', field: 'offset' },
        ],
        oracle_fusion_financials_list_payables_invoice_installments: [
          {
            text: 'List installments for Payables invoice',
            field: ['invoiceSelector', 'invoiceUniqIdManual'],
            core: true,
          },
          { text: ', matching', field: 'q' },
          { text: ', up to', field: 'limit', after: 'installments' },
          { text: ', starting at offset', field: 'offset' },
        ],
        oracle_fusion_financials_list_payables_payments: [
          'List Payables payments',
          { text: ', matching', field: 'q' },
          { text: ', ordered by', field: 'orderBy' },
          { text: ', up to', field: 'limit', after: 'records' },
          { text: ', starting at offset', field: 'offset' },
        ],
        oracle_fusion_financials_get_payables_payment: [
          { text: 'Read Payables payment', field: 'checkId', core: true },
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
          label: 'List Payables Invoice Installments',
          id: 'oracle_fusion_financials_list_payables_invoice_installments',
        },
        {
          label: 'List Payables Payments',
          id: 'oracle_fusion_financials_list_payables_payments',
        },
        {
          label: 'Get Payables Payment',
          id: 'oracle_fusion_financials_get_payables_payment',
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
          'oracle_fusion_financials_list_payables_invoice_installments',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
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
          'oracle_fusion_financials_list_payables_invoice_installments',
        ],
      },
      required: {
        field: 'operation',
        value: [
          'oracle_fusion_financials_get_payables_invoice',
          'oracle_fusion_financials_list_payables_invoice_lines',
          'oracle_fusion_financials_list_payables_invoice_installments',
        ],
      },
    },
    {
      id: 'checkId',
      title: 'Payment Check ID',
      type: 'short-input',
      placeholder: 'Oracle payment CheckId',
      condition: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment',
      },
      required: {
        field: 'operation',
        value: 'oracle_fusion_financials_get_payables_payment',
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
          'oracle_fusion_financials_list_payables_payments',
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
          'oracle_fusion_financials_list_payables_payments',
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
          'oracle_fusion_financials_list_payables_payments',
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
          'oracle_fusion_financials_list_payables_payments',
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
          'oracle_fusion_financials_list_payables_payments',
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
          'oracle_fusion_financials_list_payables_payments',
        ],
      },
    },
  ],
  tools: {
    access: [
      'oracle_fusion_financials_list_payables_invoices',
      'oracle_fusion_financials_get_payables_invoice',
      'oracle_fusion_financials_list_payables_invoice_lines',
      'oracle_fusion_financials_list_payables_invoice_installments',
      'oracle_fusion_financials_list_payables_payments',
      'oracle_fusion_financials_get_payables_payment',
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
    checkId: { type: 'string', description: 'Oracle payment CheckId as a decimal string' },
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
      description: 'Projected invoices, invoice lines, installments, or payments for this page',
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
  },
}

export const OracleFusionFinancialsBlockMeta = {
  tags: ['automation', 'data-analytics', 'payments'],
  url: 'https://www.oracle.com/erp/financials/',
  templates: [
    {
      icon: OracleIcon,
      title: 'Find overdue Payables invoices',
      prompt:
        'Build a scheduled workflow that lists unpaid Oracle Fusion Payables invoices, reviews their installments for due dates before today, and sends a concise overdue-invoice report without fetching additional pages automatically.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: OracleIcon,
      title: 'Report unpaid invoice aging',
      prompt:
        'Create a workflow that reads one bounded page of unpaid Oracle Fusion Payables invoices, groups amounts into aging buckets from invoice and installment dates, and writes the summary to a table.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
    },
    {
      icon: OracleIcon,
      title: 'Monitor invoice approval exceptions',
      prompt:
        'Build a scheduled Oracle Fusion workflow that lists Payables invoices with exceptional approval status and sends finance a report containing invoice number, supplier, amount, currency, and status.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: OracleIcon,
      title: 'Monitor invoice validation exceptions',
      prompt:
        'Build a scheduled workflow that lists Oracle Fusion Payables invoices with validation exceptions and records their identifiers, suppliers, amounts, and validation status for investigation.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'monitoring'],
    },
    {
      icon: OracleIcon,
      title: 'Audit Payables invoice lines',
      prompt:
        'Create a workflow that selects an Oracle Fusion Payables invoice, reads its invoice lines, and reports line amounts, purchase-order and receipt references, tax codes, and approval status.',
      modules: ['workflows'],
      category: 'operations',
      tags: ['finance', 'audit'],
    },
    {
      icon: OracleIcon,
      title: 'Track upcoming payment installments',
      prompt:
        'Create a scheduled workflow that reviews Oracle Fusion Payables invoice installments due in the coming week and sends a treasury digest with unpaid amount, due date, payment method, priority, and hold state.',
      modules: ['scheduled', 'workflows'],
      category: 'operations',
      tags: ['finance', 'payments'],
    },
    {
      icon: OracleIcon,
      title: 'Reconcile recent Payables payments',
      prompt:
        'Build a scheduled workflow that lists one page of recent Oracle Fusion Payables payments, separates reconciled and unreconciled records, and writes a reconciliation report with payment identifiers, dates, amounts, and status.',
      modules: ['scheduled', 'tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'payments'],
    },
    {
      icon: OracleIcon,
      title: 'Create a supplier payment report',
      prompt:
        'Create a workflow that lists Oracle Fusion Payables payments for a specified reporting period and produces a supplier-level report using payee, supplier number, amount, currency, method, status, and payment date.',
      modules: ['tables', 'workflows'],
      category: 'operations',
      tags: ['finance', 'reporting'],
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
      name: 'review-oracle-fusion-payment-schedules',
      description: 'Review due dates, unpaid amounts, discounts, and holds for an invoice.',
      content:
        '# Review Oracle Fusion Payment Schedules\n\n## Steps\n\n1. Select the invoice or provide its Oracle-derived opaque key.\n2. Use List Payables Invoice Installments for one bounded page.\n3. Compare due date, unpaid amount, payment priority, hold state, and available discount dates and amounts.\n\n## Output\n\nSummarize upcoming obligations and holds without guessing missing installment fields.',
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
        '# Reconcile Recent Oracle Fusion Payments\n\n## Steps\n\n1. Use List Payables Payments ordered by PaymentDate descending with one bounded page.\n2. Review CheckId, payment references, amount, currency, date, status, and ReconciledFlag.\n3. Use Get Payables Payment with the decimal CheckId for a specific projected payment.\n\n## Output\n\nReport reconciled and unreconciled payments separately and state whether another page remains.',
    },
  ],
} as const satisfies BlockMeta
