import { z } from 'zod'
import { createFccsContext, parseFccsInput } from '@/lib/internal/oracle-epm-fccs/context'
import { waitForFccsJob } from '@/lib/internal/oracle-epm-fccs/jobs'
import { fccsJobId, fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsWaitForJobParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  jobId: fccsJobId,
  maxWaitSeconds: z.number().int().min(1).max(86400).default(300),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status.html */
export const executeFccsWaitForJobOperation: InternalToolOperationImplementation<
  FccsWaitForJobParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return waitForFccsJob(ctx, input.application, input.jobId, input.maxWaitSeconds)
}
