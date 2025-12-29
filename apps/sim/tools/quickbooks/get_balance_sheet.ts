import QuickBooks from 'node-quickbooks'
import type { GetBalanceSheetParams, BalanceSheetResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksGetBalanceSheetTool: ToolConfig<
  GetBalanceSheetParams,
  BalanceSheetResponse
> = {
  id: 'quickbooks_get_balance_sheet',
  name: 'QuickBooks Get Balance Sheet',
  description: 'Generate Balance Sheet report from QuickBooks Online',
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
    date: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Report date (YYYY-MM-DD format). Defaults to today.',
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
      if (params.date) reportParams.date = params.date
      if (params.accounting_method) reportParams.accounting_method = params.accounting_method

      const report = await new Promise<any>((resolve, reject) => {
        qbo.reportBalanceSheet(reportParams, (err: any, result: any) => {
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
            ReportDate: report.Header?.Time,
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
        error: `QUICKBOOKS_GET_BALANCE_SHEET_ERROR: Failed to get balance sheet - ${errorDetails}`,
      }
    }
  },

  outputs: {
    report: {
      type: 'json',
      description: 'The complete Balance Sheet report object',
    },
    metadata: {
      type: 'json',
      description: 'Report metadata including report date and currency',
    },
  },
}
