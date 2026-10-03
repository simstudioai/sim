import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import {
  assertFccsHierarchyBudget,
  fccsHierarchySchema,
  fccsName,
} from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsGetDimensionParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  cube: fccsName,
  dimension: fccsName,
  aliasTableName: fccsName.optional(),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_dim_details.html */
export const executeFccsGetDimensionOperation: InternalToolOperationImplementation<
  FccsGetDimensionParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  const response = await ctx.client.request(fccsEndpoints.getDimension, {
    pathParams: { application: input.application, cube: input.cube, dimension: input.dimension },
    query: { fields: 'id,name,path,alias,children', aliasTableName: input.aliasTableName },
    signal,
  })
  if ('data' in response) assertFccsHierarchyBudget(response.data)
  return fccsResult({ ...projectFccsResponse(fccsHierarchySchema, response) })
}
