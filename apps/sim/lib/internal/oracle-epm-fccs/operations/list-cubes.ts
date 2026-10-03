import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import { fccsCubesSchema, fccsName } from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsListCubesParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_plan_types.html */
export const executeFccsListCubesOperation: InternalToolOperationImplementation<
  FccsListCubesParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(
    projectFccsResponse(
      fccsCubesSchema,
      await ctx.client.request(fccsEndpoints.listCubes, {
        pathParams: { application: input.application },
        signal,
      })
    )
  )
}
