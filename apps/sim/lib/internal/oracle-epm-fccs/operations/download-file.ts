import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
} from '@/lib/internal/oracle-epm-fccs/context'
import { downloadFccsFile } from '@/lib/internal/oracle-epm-fccs/files'
import { fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsDownloadFileParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  fileName: fccsName,
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/download.html */
export const executeFccsDownloadFileOperation: InternalToolOperationImplementation<
  FccsDownloadFileParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(await downloadFccsFile(ctx, input.fileName))
}
