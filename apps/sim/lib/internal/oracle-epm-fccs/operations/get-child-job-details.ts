import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsNextPage } from '@/lib/internal/oracle-epm-fccs/links'
import {
  fccsChildJobDetailsSchema,
  fccsChildJobType,
  fccsJobId,
  fccsName,
  fccsPageInput,
} from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsGetChildJobDetailsParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  jobId: fccsJobId,
  childJobId: fccsJobId,
  childJobType: fccsChildJobType,
  offset: fccsPageInput.offset,
  limit: fccsPageInput.limit,
  messageType: z.enum(['ERROR', 'WARNING', 'INFO']).optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_child_job_status_details.html */
export const executeFccsGetChildJobDetailsOperation: InternalToolOperationImplementation<
  FccsGetChildJobDetailsParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  const output = projectFccsResponse(
    fccsChildJobDetailsSchema,
    await ctx.client.request(fccsEndpoints.getChildJobDetails, {
      pathParams: {
        application: input.application,
        jobId: input.jobId,
        childJobId: input.childJobId,
      },
      query: {
        offset: input.offset,
        limit: input.limit,
        q: input.messageType ? JSON.stringify({ messageType: input.messageType }) : undefined,
      },
      signal,
    })
  )
  return fccsResult({
    items: output.items,
    ...fccsNextPage(ctx.client, fccsEndpoints.getChildJobDetails, output.links, input),
  })
}
