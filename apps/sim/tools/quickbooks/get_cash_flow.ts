import QuickBooks from 'node-quickbooks'
import type { GetCashFlowParams, CashFlowResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksGetCashFlowTool: ToolConfig<GetCashFlowParams, CashFlowResponse> = {
  id: 'quickbooks_get_cash_flow',
  name: 'QuickBooks Get Cash Flow',
  description: 'Generate Cash Flow Statement report from QuickBooks Online',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'QuickBooks OAuth access token',
    },
    realmId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'QuickBooks company ID (realm ID)',
    },
    start_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date for the report (YYYY-MM-DD format). Defaults to beginning of fiscal year.',
    },
    end_date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date for the report (YYYY-MM-DD format). Defaults to today.',
    },
    accounting_method: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Accounting method: Cash or Accrual (default: Accrual)',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', undefined
      )

      const reportParams: any = {}
      if (params.start_date) reportParams.start_date = params.start_date
      if (params.end_date) reportParams.end_date = params.end_date
      if (params.accounting_method) reportParams.accounting_method = params.accounting_method

      const report = await new Promise<any>((resolve, reject) => {
        qbo.reportCashFlow(reportParams, (err: any, result: any) => {
          if (err) reject(err)
          else resolve(result)
        })
      })

      return {
        success: true,
        output: {
          report,
          metadata: {
            ReportName: report.Header?.ReportName,
            StartPeriod: report.Header?.StartPeriod,
            EndPeriod: report.Header?.EndPeriod,
            Currency: report.Header?.Currency,
          },
        },
      }
    } catch (error: any) {
      const errorDetails = error.response?.body
        ? JSON.stringify(error.response.body)
        : error.message || 'Unknown error'
      return {
        success: false,
        output: {},
        error: `QUICKBOOKS_GET_CASH_FLOW_ERROR: Failed to get cash flow report - ${errorDetails}`,
      }
    }
  },

  outputs: {
    report: {
      type: 'json',
      description: 'The complete Cash Flow Statement report object',
    },
    metadata: {
      type: 'json',
      description: 'Report metadata including date range and currency',
    },
  },
}
