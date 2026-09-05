import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { exportArcsUserReport } from '@/lib/internal/oracle-epm-account-reconciliation/files'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationExportUserDetailsReportParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/reports_arcs_generate_user_details_report.html */
export const executeOracleEpmAccountReconciliationExportUserDetailsReportOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationExportUserDetailsReportParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.export_user_details_report,
    input,
    signal,
    context,
    (params, client, signal, context) => exportArcsUserReport(client, params, context, signal)
  )
