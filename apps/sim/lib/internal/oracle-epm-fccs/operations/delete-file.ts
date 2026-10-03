import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
} from '@/lib/internal/oracle-epm-fccs/context'
import { deleteFccsFile } from '@/lib/internal/oracle-epm-fccs/files'
import { fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsDeleteFileParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  fileName: fccsName,
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/delete_files_v3.html */
export const executeFccsDeleteFileOperation: InternalToolOperationImplementation<
  FccsDeleteFileParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(await deleteFccsFile(ctx, input.fileName))
}
