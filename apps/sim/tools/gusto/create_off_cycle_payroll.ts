import type {
  GustoCreateOffCyclePayrollParams,
  GustoPayrollRecordResponse,
} from '@/tools/gusto/types'
import { PAYROLL_OUTPUT_PROPERTIES } from '@/tools/gusto/types'
import { GUSTO_API_BASE, gustoErrorMessage, gustoHeaders } from '@/tools/gusto/utils'
import type { ToolConfig } from '@/tools/types'

export const gustoCreateOffCyclePayrollTool: ToolConfig<
  GustoCreateOffCyclePayrollParams,
  GustoPayrollRecordResponse
> = {
  id: 'gusto_create_off_cycle_payroll',
  name: 'Gusto Create Off-Cycle Payroll',
  description: 'Create an off-cycle payroll for a Gusto company',
  version: '1.0.0',

  oauth: { required: true, provider: 'gusto' },

  params: {
    companyId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Gusto company UUID',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pay period start date (YYYY-MM-DD)',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Pay period end date (YYYY-MM-DD)',
    },
    checkDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Check date (YYYY-MM-DD). Defaults to the next available payday',
    },
    payScheduleUuid: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pay schedule UUID to associate with this off-cycle payroll',
    },
    fixedWithholdingRate: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Use fixed supplemental withholding rate (e.g. for bonuses)',
    },
    offCycleReason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Off-cycle reason. One of: Benefit reversal, Bonus, Correction, Dismissed employee, Hired employee, Wage correction, Tax reconciliation, Reversal, Disability insurance distribution, Transition from old pay schedule',
    },
    employeeUuids: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated employee UUIDs to include',
    },
    withholdingPayPeriod: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Withholding pay period override',
    },
    skipRegularDeductions: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip regular deductions',
    },
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token',
    },
  },

  request: {
    url: (params) =>
      `${GUSTO_API_BASE}/companies/${encodeURIComponent(params.companyId.trim())}/payrolls`,
    method: 'POST',
    headers: (params) => gustoHeaders(params.accessToken),
    body: (params) => {
      const body: Record<string, unknown> = {
        off_cycle: true,
        start_date: params.startDate,
        end_date: params.endDate,
        off_cycle_reason: params.offCycleReason,
      }
      if (params.checkDate) body.check_date = params.checkDate
      if (params.payScheduleUuid) body.pay_schedule_uuid = params.payScheduleUuid
      if (params.fixedWithholdingRate !== undefined) {
        body.fixed_withholding_rate = params.fixedWithholdingRate
      }
      if (params.employeeUuids) {
        body.employee_uuids = params.employeeUuids
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
      if (params.withholdingPayPeriod) body.withholding_pay_period = params.withholdingPayPeriod
      if (params.skipRegularDeductions !== undefined) {
        body.skip_regular_deductions = params.skipRegularDeductions
      }
      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return {
        success: false,
        error: gustoErrorMessage(data, 'Failed to create off-cycle payroll'),
        output: {},
      }
    }
    return { success: true, output: { payroll: data } }
  },

  outputs: {
    payroll: {
      type: 'object',
      description: 'Created off-cycle payroll',
      properties: PAYROLL_OUTPUT_PROPERTIES,
    },
  },
}
