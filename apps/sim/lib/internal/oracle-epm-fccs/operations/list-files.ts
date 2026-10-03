import { createFccsContext, fccsResult } from '@/lib/internal/oracle-epm-fccs/context'
import { listFccsFiles } from '@/lib/internal/oracle-epm-fccs/files'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsListFilesParams } from '@/tools/oracle_epm_fccs/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/list_files_v2.html */
export const executeFccsListFilesOperation: InternalToolOperationImplementation<
  FccsListFilesParams
> = async (params, signal, context) => {
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(await listFccsFiles(ctx))
}
