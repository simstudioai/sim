import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { uploadArcsFile } from '@/lib/internal/oracle-epm-account-reconciliation/files'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationUploadFileParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/upload.html */
export const executeOracleEpmAccountReconciliationUploadFileOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationUploadFileParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.upload_file,
    input,
    signal,
    context,
    (params, client, signal, context) => uploadArcsFile(client, params, context, signal)
  )
