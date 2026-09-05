import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import {
  fccsJobDefinitionsSchema,
  fccsJobType,
  fccsJobTypes,
  fccsName,
} from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsListJobDefinitionsParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  jobType: fccsJobType.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_job_definitions.html */
export const executeFccsListJobDefinitionsOperation: InternalToolOperationImplementation<
  FccsListJobDefinitionsParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  const output = projectFccsResponse(
    fccsJobDefinitionsSchema,
    await ctx.client.request(fccsEndpoints.listJobDefinitions, {
      pathParams: { application: input.application },
      query: {
        q: input.jobType === undefined ? undefined : JSON.stringify({ jobType: input.jobType }),
      },
      signal,
    })
  )
  const allowed = new Set(fccsJobTypes.map((type) => type.toUpperCase()))
  return fccsResult({
    items: output.items.filter((item) => allowed.has(item.jobType.toUpperCase())),
  })
}
