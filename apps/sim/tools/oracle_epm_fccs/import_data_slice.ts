import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsImportDataSliceParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/import_dataslices.html */
export const oracleEpmFccsImportDataSliceTool: InternalToolConfig<
  FccsImportDataSliceParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_import_data_slice',
  name: 'Oracle EPM FCCS Import Data Slice',
  description:
    'Import a numeric Essbase data grid and return accepted/rejected cell counts and documented rejection reasons.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    cube: fccsParamFields.cube,
    dataGrid: fccsParamFields.dataGrid,
    aggregateEssbaseData: { ...fccsParamFields.aggregateEssbaseData, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    numAcceptedCells: {
      type: 'number',
      description: 'Cells accepted',
    },
    numUpdateCells: {
      type: 'number',
      description: 'Cells actually updated',
      optional: true,
    },
    numRejectedCells: {
      type: 'number',
      description: 'Cells rejected',
    },
    rejectedCells: {
      type: 'array',
      description: 'First rejected cell coordinates (Oracle maximum 100)',
      items: {
        type: 'string',
      },
      optional: true,
    },
    rejectedCellsWithDetails: {
      type: 'array',
      description: 'Rejection reasons',
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
      optional: true,
    },
  },
}
