import { z } from 'zod'
import {
  createFccsContext,
  fccsResult,
  parseFccsInput,
  projectFccsResponse,
} from '@/lib/internal/oracle-epm-fccs/context'
import { fccsEndpoints } from '@/lib/internal/oracle-epm-fccs/endpoints'
import {
  fccsDataGridInput,
  fccsImportSliceSchema,
  fccsName,
} from '@/lib/internal/oracle-epm-fccs/schemas'
import type { InternalToolOperationImplementation } from '@/lib/internal/tool-operations/types'
import type { FccsImportDataSliceParams } from '@/tools/oracle_epm_fccs/types'

const inputSchema = z.object({
  application: fccsName,
  cube: fccsName,
  dataGrid: fccsDataGridInput,
  aggregateEssbaseData: z.boolean().default(false),
})

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_dataslices.html */
export const executeFccsImportDataSliceOperation: InternalToolOperationImplementation<
  FccsImportDataSliceParams
> = async (params, signal, context) => {
  const input = parseFccsInput(inputSchema, params)
  const ctx = createFccsContext(params, signal, context)
  return fccsResult(
    projectFccsResponse(
      fccsImportSliceSchema,
      await ctx.client.request(fccsEndpoints.importDataSlice, {
        pathParams: { application: input.application, cube: input.cube },
        json: {
          dataGrid: input.dataGrid,
          aggregateEssbaseData: input.aggregateEssbaseData,
          cellNotesOption: 'Skip',
          customParams: { IncludeRejectedCells: true, IncludeRejectedCellsWithDetails: true },
        },
        signal,
      })
    )
  )
}
