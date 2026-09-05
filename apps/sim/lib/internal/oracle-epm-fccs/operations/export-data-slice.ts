import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import {
  fccsDataGridSchema,
  fccsGridDefinition,
  fccsName,
} from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsExportDataSliceParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  cube: fccsName,
  gridDefinition: fccsGridDefinition,
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_dataslices.html */
export const executeFccsExportDataSliceOperation: InternalToolOperationImplementation<
  FccsExportDataSliceParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(
    projectFccsResponse(
      fccsDataGridSchema,
      await ctx.client.request(fccsEndpoints.exportDataSlice, {
        pathParams: { application: input.application, cube: input.cube },
        json: { exportPlanningData: false, gridDefinition: input.gridDefinition },
        signal,
      })
    )
  )
}
