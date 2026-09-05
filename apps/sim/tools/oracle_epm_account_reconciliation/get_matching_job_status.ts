import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmAccountReconciliationGetMatchingJobStatusParams,
  OracleEpmAccountReconciliationResponse,
} from '@/tools/oracle_epm_account_reconciliation/types'
import { ARCS_MATCHING_OUTPUTS } from '@/tools/oracle_epm_account_reconciliation/types'
import { arcsAuthParamFields } from '@/tools/oracle_epm_account_reconciliation/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmAccountReconciliationGetMatchingJobStatusTool: InternalToolConfig<
  OracleEpmAccountReconciliationGetMatchingJobStatusParams,
  OracleEpmAccountReconciliationResponse
> = {
  id: 'oracle_epm_account_reconciliation_get_matching_job_status',
  name: 'Oracle EPM Account Reconciliation Get Matching Job Status',
  description: 'Read one Transaction Matching job status and validated artifact filenames.',
  version: '1.0.0',
  params: {
    ...arcsAuthParamFields,
    jobId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Transaction Matching job ID',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ARCS_MATCHING_OUTPUTS,
}
