import {
  arcsInputSchemas,
  executeArcsOperation,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import {
  getArcsFileContext,
  storeArcsFile,
} from '@/lib/internal/oracle-epm-account-reconciliation/files'
import { arcsRoutes } from '@/lib/internal/oracle-epm-account-reconciliation/routes'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationDownloadFileParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/download.html */
export const executeOracleEpmAccountReconciliationDownloadFileOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationDownloadFileParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.download_file,
    input,
    signal,
    context,
    async (params, client, signal, context) => {
      const fileContext = getArcsFileContext(context)
      const file = await storeArcsFile(
        await client.request(arcsRoutes.downloadFile, {
          pathParams: { fileName: params.fileName },
          signal,
        }),
        params.fileName,
        fileContext,
        signal
      )
      return { success: true, output: { file } }
    }
  )
