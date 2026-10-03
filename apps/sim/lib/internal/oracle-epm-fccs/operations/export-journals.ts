import { z } from 'zod'
import { createFccsContext, parseFccsInput } from '@/lib/internal/oracle-epm-fccs/context'
import { submitFccsJob } from '@/lib/internal/oracle-epm-fccs/jobs'
import { fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsExportJournalsParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  fileName: fccsName,
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/fccs_export_consolidation_journals.html */
export const executeFccsExportJournalsOperation: InternalToolOperationImplementation<
  FccsExportJournalsParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return submitFccsJob(ctx, input.application, 'EXPORT_JOURNAL', 'Export Journal', {
    fileName: input.fileName,
  })
}
