import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import {
  fccsDimensionsSchema,
  fccsName,
  fccsPageInput,
  fccsParameters,
} from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsListDimensionsParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  cube: fccsName,
  offset: fccsPageInput.offset,
  limit: fccsPageInput.limit,
  filter: fccsParameters.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_dim_plan_types.html */
export const executeFccsListDimensionsOperation: InternalToolOperationImplementation<
  FccsListDimensionsParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(
    projectFccsResponse(
      fccsDimensionsSchema,
      await ctx.client.request(fccsEndpoints.listDimensions, {
        pathParams: { application: input.application, cube: input.cube },
        query: {
          offset: input.offset,
          limit: input.limit,
          q: input.filter === undefined ? undefined : JSON.stringify(input.filter),
        },
        signal,
      })
    )
  )
}
