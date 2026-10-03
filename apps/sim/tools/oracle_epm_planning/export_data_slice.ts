import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningExportDataSliceParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_dataslices.html */
export const oracleEpmPlanningExportDataSliceTool: InternalToolConfig<
  OracleEpmPlanningExportDataSliceParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_export_data_slice',
  name: 'Oracle EPM Planning Export Data Slice',
  description:
    'Export a bounded cell grid. Missing-cell suppression is configured in gridDefinition. Maximum inline response: 16 MiB.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    cube: { ...oracleEpmPlanningParamFields.cube, required: true },
    gridDefinition: { ...oracleEpmPlanningParamFields.gridDefinition, required: true },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    dataGrid: {
      type: 'json',
      description: 'Exported cell grid',
      properties: {
        pov: {
          type: 'array',
          description: 'POV members',
          items: {
            type: 'string',
          },
        },
        columns: {
          type: 'array',
          description: 'Column members',
          items: {
            type: 'array',
            description: 'Member or cell values in axis order',
          },
        },
        rows: {
          type: 'array',
          description: 'Data rows',
          items: {
            type: 'object',
            properties: {
              headers: {
                type: 'array',
                description: 'Row headers',
                items: {
                  type: 'string',
                },
              },
              data: {
                type: 'array',
                description: 'Cell values; strings or numbers',
                items: {
                  type: 'json',
                },
              },
            },
          },
        },
      },
    },
  },
}
