import { z } from 'zod'
import { createFccsContext, parseFccsInput } from '@/lib/internal/oracle-epm-fccs/context'
import { submitFccsJob } from '@/lib/internal/oracle-epm-fccs/jobs'
import { fccsName, fccsParameters } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsExportJobConsoleParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  jobName: fccsName.optional(),
  parameters: fccsParameters.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/pbcs_export_job_console_job.html */
export const executeFccsExportJobConsoleOperation: InternalToolOperationImplementation<
  FccsExportJobConsoleParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return submitFccsJob(ctx, input.application, 'JOBCONSOLE_EXPORT', input.jobName, input.parameters)
}
