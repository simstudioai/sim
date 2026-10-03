import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningClearDataSliceParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/clear_dataslices.html */
export const oracleEpmPlanningClearDataSliceTool: InternalToolConfig<
  OracleEpmPlanningClearDataSliceParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_clear_data_slice',
  name: 'Oracle EPM Planning Clear Data Slice',
  description:
    'Destructively clear the selected Essbase cells and/or Planning details. Returns rejected cells; requires Service Administrator.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    cube: { ...oracleEpmPlanningParamFields.cube, required: true },
    gridDefinition: { ...oracleEpmPlanningParamFields.gridDefinition, required: true },
    clearEssbaseData: { ...oracleEpmPlanningParamFields.clearEssbaseData, required: false },
    clearPlanningData: { ...oracleEpmPlanningParamFields.clearPlanningData, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    clearResult: {
      type: 'json',
      description: 'Clear counts and rejection diagnostics',
      properties: {
        numClearedCells: {
          type: 'number',
          description: 'Cleared cells',
        },
        numRejectedCells: {
          type: 'number',
          description: 'Rejected cells',
        },
        rejectedCells: {
          type: 'array',
          description: 'Rejected cells',
          items: {
            type: 'string',
          },
        },
      },
    },
  },
}
