import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  QuickBooksRunFinancialReportParams,
  QuickBooksRunFinancialReportResponse,
} from '@/tools/quickbooks/types'
import {
  QUICKBOOKS_REPORT_COLUMNS_PROPERTIES,
  QUICKBOOKS_REPORT_HEADER_PROPERTIES,
  QUICKBOOKS_REPORT_ROWS_PROPERTIES,
} from '@/tools/quickbooks/types'
import {
  buildQuickBooksReportUrl,
  getQuickBooksToolHeaders,
  transformQuickBooksReportResponse,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickbooksRunFinancialReportTool: ToolConfig<
  QuickBooksRunFinancialReportParams,
  QuickBooksRunFinancialReportResponse
> = {
  id: 'quickbooks_run_financial_report',
  name: 'QuickBooks Run Financial Report',
  description: 'Run a fixed QuickBooks financial report with verified accountant-focused filters',
  version: '1.0.0',
  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks company ID derived from the connected credential',
    },
    quickBooksEnvironment: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'QuickBooks API environment derived from the connected credential',
    },
    reportType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Fixed QuickBooks financial report to run',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Report start date in YYYY-MM-DD format; Intuit recommends periods of six months or less for performance',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Report end or as-of date in YYYY-MM-DD format',
    },
    dateMacro: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Predefined QuickBooks report date range, such as this_fiscal_year_to_date; cannot be combined with startDate or endDate',
    },
    accountingMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use the QuickBooks default, cash basis, or accrual basis',
    },
    summarizeBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time period or business dimension used to summarize report columns',
    },
    quickZoomUrl: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Ask QuickBooks to generate quick-zoom drill-down links, returned as the href on report row values',
    },
    customerId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Single QuickBooks customer ID filter',
    },
    vendorId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Single QuickBooks vendor ID filter',
    },
    accountId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Single QuickBooks account ID filter',
    },
    employeeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Single QuickBooks employee ID filter, supported by Profit and Loss Detail',
    },
    itemId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Single QuickBooks item ID filter',
    },
    classId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Single QuickBooks class ID filter',
    },
    departmentId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Single QuickBooks department ID filter',
    },
    agingMethod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Age open balances from the report date or current date',
    },
    agingDays: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Positive number of days in each aging period',
    },
    transactionType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Transaction type filter for Transaction List',
    },
    groupBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Grouping dimension for Transaction List',
    },
    accountsPayablePaid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounts-payable paid status for Transaction List',
    },
    accountsReceivablePaid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounts-receivable paid status for Transaction List',
    },
    clearedStatus: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cleared status filter for Transaction List',
    },
    documentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Document number filter for Transaction List',
    },
    sourceAccountType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source account type filter for Transaction List',
    },
  },
  oauth: {
    required: true,
    provider: 'quickbooks',
    authoritativeParams: ['realmId', 'quickBooksEnvironment'],
    requiredScopes: ['com.intuit.quickbooks.accounting'],
  },
  errorExtractor: ErrorExtractorId.QUICKBOOKS_FAULT,
  request: {
    url: (params) => buildQuickBooksReportUrl(params).toString(),
    method: 'GET',
    headers: (params) => getQuickBooksToolHeaders(params.accessToken),
    retry: { enabled: false },
  },
  transformResponse: async (response, params) => {
    if (!params) throw new Error('QuickBooks report parameters are required')
    return transformQuickBooksReportResponse(response, params.reportType)
  },
  outputs: {
    reportType: {
      type: 'string',
      description: 'Financial report type that was run',
    },
    header: {
      type: 'json',
      description:
        'Native QuickBooks report header with name, periods, basis, currency, summarization, filters, and options',
      properties: QUICKBOOKS_REPORT_HEADER_PROPERTIES,
    },
    columns: {
      type: 'json',
      description: 'Native QuickBooks report column definitions',
      properties: QUICKBOOKS_REPORT_COLUMNS_PROPERTIES,
    },
    rows: {
      type: 'json',
      description: 'Native hierarchical QuickBooks report rows and section summaries',
      properties: QUICKBOOKS_REPORT_ROWS_PROPERTIES,
    },
    time: {
      type: 'string',
      description: 'QuickBooks response timestamp',
      optional: true,
      nullable: true,
    },
  },
}
