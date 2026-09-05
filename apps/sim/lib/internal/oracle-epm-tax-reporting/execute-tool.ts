import { z } from 'zod'
import { OracleEpmError } from '@/lib/internal/oracle-epm'
import {
  executeTaxReportingOperation,
  TaxReportingContractError,
} from '@/lib/internal/oracle-epm-tax-reporting/operations'
import type { TaxOperation } from '@/lib/internal/oracle-epm-tax-reporting/schema'
import { parseTaxInput, TAX_OPERATIONS } from '@/lib/internal/oracle-epm-tax-reporting/schema'
import type { InternalToolOperationHandler } from '@/lib/internal/tool-operations/types'

export const TAX_REPORTING_TOOL_IDS = TAX_OPERATIONS.map(
  (operation) => `oracle_epm_tax_reporting_${operation}`
)
const toolIds = new Set(TAX_REPORTING_TOOL_IDS)

/** In-process dispatch, with authority supplied only by the executor's trusted context. */
export const executeTaxReportingTool: InternalToolOperationHandler = async ({
  toolId,
  input,
  context,
  signal,
}) => {
  signal?.throwIfAborted()
  if (!toolIds.has(toolId))
    return Response.json(
      { success: false, error: 'Unsupported Tax Reporting tool' },
      { status: 500 }
    )
  let parsed: ReturnType<typeof parseTaxInput>
  try {
    parsed = parseTaxInput(toolId.slice('oracle_epm_tax_reporting_'.length) as TaxOperation, input)
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? `Invalid Tax Reporting input: ${error.issues[0]?.path.join('.') || 'parameters'}`
        : error instanceof Error
          ? error.message
          : 'Invalid Tax Reporting input'
    return Response.json({ success: false, error: message }, { status: 400 })
  }
  try {
    const output = await executeTaxReportingOperation(parsed, context, signal)
    const planning =
      [
        'copy_data',
        'clear_data',
        'run_rule',
        'run_ruleset',
        'execute_job',
        'export_metadata',
        'import_metadata',
      ].includes(parsed.operation) ||
      (parsed.operation === 'get_job_status' && parsed.jobFamily === 'planning')
    const failed =
      typeof output.status === 'number' &&
      output.status !== -1 &&
      output.status !== 0 &&
      !(planning && output.status === 2)
    return Response.json({
      success: !failed,
      output,
      ...(failed
        ? { retryable: false, error: `Oracle Tax Reporting reported status ${output.status}` }
        : {}),
    })
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof OracleEpmError) {
      return Response.json(
        { success: false, error: error.message },
        { status: error.status ?? 502 }
      )
    }
    if (error instanceof TaxReportingContractError) {
      return Response.json({ success: false, error: error.message }, { status: 502 })
    }
    // Storage/provider exceptions may contain credentials or tenant URLs. Never reflect them.
    return Response.json(
      {
        success: false,
        error:
          'Tax Reporting operation failed; check the inputs, permissions, and Oracle job status before retrying a mutation',
      },
      { status: 500 }
    )
  }
}
