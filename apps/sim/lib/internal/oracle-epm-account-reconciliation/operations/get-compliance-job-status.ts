import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { readArcsJob } from '@/lib/internal/oracle-epm-account-reconciliation/jobs'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationGetComplianceJobStatusParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/arcs_get_job_status.html */
export const executeOracleEpmAccountReconciliationGetComplianceJobStatusOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationGetComplianceJobStatusParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.get_compliance_job_status,
    input,
    signal,
    context,
    (params, client, signal) => readArcsJob(client, 'compliance', params.jobId, signal)
  )
