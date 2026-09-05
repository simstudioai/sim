import type { OracleEpmClient } from '@/lib/internal/oracle-epm'
import {
  ArcsContractError,
  arcsFilesSchema,
  arcsInputSchemas,
  arcsStatusSchema,
  executeArcsOperation,
  parseArcsResponse,
} from '@/lib/internal/oracle-epm-account-reconciliation/contracts'
import { arcsRoutes } from '@/lib/internal/oracle-epm-account-reconciliation/routes'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { OracleEpmAccountReconciliationListFilesParams } from '@/tools/oracle_epm_account_reconciliation/types'

/** Shared listing primitive for the tool and credential-bound server selector. */
export async function listArcsFiles(client: OracleEpmClient, signal?: AbortSignal) {
  const response = await client.request(arcsRoutes.listFiles, { signal })
  if (parseArcsResponse(arcsStatusSchema, response).status !== 0)
    throw new ArcsContractError('Oracle EPM could not list files')
  return parseArcsResponse(arcsFilesSchema, response)
}

/** Oracle contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/list_files.html */
export const executeOracleEpmAccountReconciliationListFilesOperation: InternalToolOperationImplementation<
  OracleEpmAccountReconciliationListFilesParams
> = (input, signal, context) =>
  executeArcsOperation(
    arcsInputSchemas.list_files,
    input,
    signal,
    context,
    async (params, client, signal) => {
      const result = await listArcsFiles(client, signal)
      return {
        success: true,
        output: { status: result.status, details: result.details ?? null, files: result.items },
      }
    }
  )
