import {
  arcsInputSchemas,
  arcsStatusSchema,
  executeArcsOperation,
  parseArcsResponse,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { arcsRoutes } from '@/lib/internal/oracle-epm-account-reconciliation/routes'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationDeleteFileParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/delete_files_v3.html */
export const executeOracleEpmAccountReconciliationDeleteFileOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationDeleteFileParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.delete_file,
    input,
    signal,
    context,
    async (params, client, signal) => {
      const result = parseArcsResponse(
        arcsStatusSchema,
        await client.request(arcsRoutes.deleteFile, { json: { fileName: params.fileName }, signal })
      )
      const output = {
        status: result.status,
        details: result.details ?? null,
        fileName: params.fileName,
      }
      return result.status !== 0
        ? { success: false, error: 'Oracle EPM could not delete the file', output }
        : { success: true, output }
    }
  )
