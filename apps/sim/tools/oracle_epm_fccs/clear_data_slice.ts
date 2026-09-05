import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsClearDataSliceParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/clear_dataslices.html */
export const oracleEpmFccsClearDataSliceTool: InternalToolConfig<
  FccsClearDataSliceParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_clear_data_slice',
  name: 'Oracle EPM FCCS Clear Data Slice',
  description: 'Clear an Essbase grid slice and return cleared/rejected cell counts.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    cube: fccsParamFields.cube,
    gridDefinition: fccsParamFields.gridDefinition,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    numClearedCells: {
      type: 'number',
      description: 'Cells cleared',
    },
    numRejectedCells: {
      type: 'number',
      description: 'Cells rejected',
    },
    rejectedCells: {
      type: 'array',
      description: 'Rejected cell coordinates',
      items: {
        type: 'string',
      },
    },
  },
}
