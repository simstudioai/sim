import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningImportDataSliceParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_dataslices.html */
export const oracleEpmPlanningImportDataSliceTool: InternalToolConfig<
  OracleEpmPlanningImportDataSliceParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_import_data_slice',
  name: 'Oracle EPM Planning Import Data Slice',
  description:
    'Write a cell grid and return accepted, updated, and rejected counts plus rejection details. #missing clears a cell.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    cube: { ...oracleEpmPlanningParamFields.cube, required: true },
    dataGrid: { ...oracleEpmPlanningParamFields.dataGrid, required: true },
    importOptions: { ...oracleEpmPlanningParamFields.importOptions, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    importResult: {
      type: 'json',
      description: 'Import counts and rejection diagnostics',
      properties: {
        numAcceptedCells: {
          type: 'number',
          description: 'Accepted cells',
        },
        numUpdateCells: {
          type: 'number',
          description: 'Updated cells',
        },
        numRejectedCells: {
          type: 'number',
          description: 'Rejected cells',
        },
        rejectedCells: {
          type: 'array',
          description: 'Rejected cells (Oracle reports at most 100)',
          items: {
            type: 'string',
          },
        },
        rejectedCellsWithDetails: {
          type: 'array',
          description: 'Rejected-cell reasons',
          items: {
            type: 'object',
            properties: {
              memberNames: {
                type: 'array',
                description: 'Cell members',
                items: {
                  type: 'string',
                },
              },
              readOnlyReasons: {
                type: 'array',
                description: 'Read-only reasons',
                items: {
                  type: 'string',
                },
              },
              otherReasons: {
                type: 'array',
                description: 'Other reasons',
                items: {
                  type: 'string',
                },
              },
            },
          },
        },
      },
    },
  },
}
