import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationExportUserDetailsReportParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_REPORT_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationExportUserDetailsReportTool: InternalToolConfig<
  OracleEpmAccountReconciliationExportUserDetailsReportParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_export_user_details_report',
  name: 'Oracle EPM Account Reconciliation Export User Details Report',
  description: 'Generate, wait for, and download a user-details report as a Sim file.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Repository filename for the generated report',
    },
    format: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Report format',
      default: 'CSV',
    },
    maxWaitSeconds: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum wait in seconds (5–300; default 60)',
      default: 60,
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_REPORT_OUTPUTS,
}
