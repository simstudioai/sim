import QuickBooks from 'node-quickbooks'
import type { GetProfitLossParams, ProfitLossResponse } from '@/tools/quickbooks/types'
import type { ToolConfig } from '@/tools/types'

export const quickbooksGetProfitLossTool: ToolConfig<GetProfitLossParams, ProfitLossResponse> = {
  id: 'quickbooks_get_profit_loss',
  name: 'QuickBooks Get Profit & Loss',
  description: 'Generate Profit & Loss (P&L) report from QuickBooks Online',
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
    summarize_column_by: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Summarize columns by: Total, Month, Quarter, Year (default: Total)',
    },
  },

  directExecution: async (params) => {
    try {
      const qbo = new QuickBooks(
        '', '', params.apiKey, '', params.realmId, false, false, 70, '2.0', null
      )

      const reportParams: any = {}
      if (params.start_date) reportParams.start_date = params.start_date
      if (params.end_date) reportParams.end_date = params.end_date
      if (params.accounting_method) reportParams.accounting_method = params.accounting_method
      if (params.summarize_column_by) reportParams.summarize_column_by = params.summarize_column_by

      const report = await new Promise<any>((resolve, reject) => {
        qbo.reportProfitAndLoss(reportParams, (err: any, result: any) => {
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
      return {
        success: false,
        error: {
          code: 'QUICKBOOKS_GET_PROFIT_LOSS_ERROR',
          message: error.message || 'Failed to get profit and loss report',
          details: error,
        },
      }
    }
  },

  outputs: {
    report: {
      type: 'json',
      description: 'The complete Profit & Loss report object',
    },
    metadata: {
      type: 'json',
      description: 'Report metadata including date range and currency',
    },
  },
}
