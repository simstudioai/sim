import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationGetComplianceJobStatusParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_JOB_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationGetComplianceJobStatusTool: InternalToolConfig<
  OracleEpmAccountReconciliationGetComplianceJobStatusParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_get_compliance_job_status',
  name: 'Oracle EPM Account Reconciliation Get Compliance Job Status',
  description: 'Read the status of one Reconciliation Compliance job.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Reconciliation Compliance job ID',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_JOB_OUTPUTS,
}
