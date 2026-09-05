import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsChildJobId, fccsNextPage } from '@/lib/internal/oracle-epm-fccs/links'
import {
  fccsDetailJobType,
  fccsJobDetailsSchema,
  fccsJobId,
  fccsName,
  fccsPageInput,
} from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsGetJobDetailsParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  jobId: fccsJobId,
  detailJobType: fccsDetailJobType,
  offset: fccsPageInput.offset,
  limit: fccsPageInput.limit,
  messageType: z.enum(['ERROR', 'WARNING', 'INFO']).optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/retrieve_job_status_details.html */
export const executeFccsGetJobDetailsOperation: InternalToolOperationImplementation<
  FccsGetJobDetailsParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  const output = projectFccsResponse(
    fccsJobDetailsSchema,
    await ctx.client.request(fccsEndpoints.getJobDetails, {
      pathParams: { application: input.application, jobId: input.jobId },
      query: {
        offset: input.offset,
        limit: input.limit,
        q: input.messageType ? JSON.stringify({ messageType: input.messageType }) : undefined,
      },
      signal,
    })
  )
  return fccsResult({
    items: output.items.map(({ links, ...item }) => ({
      ...item,
      ...(links ? { childJobId: fccsChildJobId(ctx.client, links, input) } : {}),
    })),
    ...fccsNextPage(ctx.client, fccsEndpoints.getJobDetails, output.links, input),
  })
}
