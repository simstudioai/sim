import { z } from 'zod'
import { isUserFileWithMetadata } from '@/lib/core/utils/user-file'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
} from '@/lib/internal/oracle-epm-fccs/context'
import { uploadFccsFile } from '@/lib/internal/oracle-epm-fccs/files'
import { fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { UserFile } from '@/executor/types'
import type { FccsUploadFileParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  file: z.custom<UserFile>(isUserFileWithMetadata),
  fileName: fccsName,
  directory: fccsName.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/upload.html */
export const executeFccsUploadFileOperation: InternalToolOperationImplementation<
  FccsUploadFileParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(await uploadFccsFile(ctx, input.file, input.fileName, input.directory))
}
