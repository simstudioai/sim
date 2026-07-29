import type { QuickBooksReportParams, QuickBooksReportResponse } from '@/tools/quickbooks/types'
import {
  buildQuickBooksHeaders,
  buildQuickBooksReportUrl,
  parseQuickBooksJson,
} from '@/tools/quickbooks/utils'
import type { ToolConfig } from '@/tools/types'

export const quickBooksRunReportTool: ToolConfig<QuickBooksReportParams, QuickBooksReportResponse> =
  {
    id: 'quickbooks_run_report',
    name: 'QuickBooks Run Report',
    description: 'Run a supported QuickBooks Online financial or accounting report',
    version: '1.0.0',

    oauth: { required: true, provider: 'quickbooks' },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token for QuickBooks Online',
      },
      realmId: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'QuickBooks company ID returned by Intuit as realmId during OAuth',
      },
      report: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'QuickBooks Reports API endpoint name',
      },
      reportParams: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description: 'Report query parameters such as start_date, end_date, and accounting_method',
      },
      apiEnvironment: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'QuickBooks API environment: production or sandbox. Defaults to production.',
      },
      minorVersion: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'QuickBooks Accounting API minor version. Defaults to 75.',
      },
    },

    request: {
      url: (params) => buildQuickBooksReportUrl(params).url,
      method: 'GET',
      headers: (params) => buildQuickBooksHeaders(params.accessToken),
    },

    transformResponse: async (response, params) => {
      if (!params) throw new Error('QuickBooks report parameters are required')
      const { report } = buildQuickBooksReportUrl(params)
      const data = await parseQuickBooksJson(response)

      return {
        success: true,
        output: {
          report,
          header: data.Header ?? {},
          columns: data.Columns ?? {},
          rows: data.Rows ?? {},
          time: typeof data.time === 'string' ? data.time : null,
        },
      }
    },

    outputs: {
      report: { type: 'string', description: 'QuickBooks report endpoint name' },
      header: {
        type: 'json',
        description: 'Report header metadata, including period, basis, and currency when returned',
      },
      columns: {
        type: 'json',
        description: 'QuickBooks report column definitions',
      },
      rows: {
        type: 'json',
        description: 'QuickBooks report rows, including nested sections and summaries',
      },
      time: {
        type: 'string',
        description: 'QuickBooks response timestamp',
        optional: true,
      },
    },
  }
