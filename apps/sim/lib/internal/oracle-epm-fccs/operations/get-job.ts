import { z } from 'zod'
import { createFccsContext, parseFccsInput } from '@/lib/internal/oracle-epm-fccs/context'
import { fccsJobResult, readFccsJob } from '@/lib/internal/oracle-epm-fccs/jobs'
import { fccsJobId, fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsGetJobParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  jobId: fccsJobId,
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status.html */
export const executeFccsGetJobOperation: InternalToolOperationImplementation<
  FccsGetJobParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsJobResult(await readFccsJob(ctx, input.application, input.jobId))
}
