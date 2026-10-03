import { z } from 'zod'
import { createFccsContext, parseFccsInput } from '@/lib/internal/oracle-epm-fccs/context'
import { submitFccsJob } from '@/lib/internal/oracle-epm-fccs/jobs'
import { fccsJobType, fccsName, fccsParameters } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsExecuteJobParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  jobType: fccsJobType,
  jobName: fccsName,
  parameters: fccsParameters.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/execute_a_job.html */
export const executeFccsExecuteJobOperation: InternalToolOperationImplementation<
  FccsExecuteJobParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return submitFccsJob(ctx, input.application, input.jobType, input.jobName, input.parameters)
}
