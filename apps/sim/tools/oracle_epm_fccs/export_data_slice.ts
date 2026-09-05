import { createInternalToolOperationInput } from '@/tools/operation-input'
import type { FccsExportDataSliceParams, FccsResponse } from '@/tools/oracle_epm_fccs/types'
import { fccsAuthParams, fccsParamFields } from '@/tools/oracle_epm_fccs/utils'
import type { InternalToolConfig } from '@/tools/types'

/** https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/export_dataslices.html */
export const oracleEpmFccsExportDataSliceTool: InternalToolConfig<
  FccsExportDataSliceParams,
  FccsResponse
> = {
  id: 'oracle_epm_fccs_export_data_slice',
  name: 'Oracle EPM FCCS Export Data Slice',
  description:
    'Export a numeric Essbase data grid for a cube and explicit point of view; excludes Planning cell notes.',
  version: '1.0.0',
  params: {
    ...fccsAuthParams,
    application: fccsParamFields.application,
    cube: fccsParamFields.cube,
    gridDefinition: fccsParamFields.gridDefinition,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    pov: {
      type: 'array',
      description: 'Point-of-view members',
      items: {
        type: 'string',
      },
    },
    columns: {
      type: 'array',
      description: 'Column member arrays',
      items: {
        type: 'array',
        description: 'Ordered column members (string[])',
      },
    },
    rows: {
      type: 'array',
      description: 'Exported data rows',
      items: {
        type: 'object',
        properties: {
          headers: {
            type: 'array',
            description: 'Row members',
            items: {
              type: 'string',
            },
          },
          data: {
            type: 'array',
            description:
              'Essbase numeric values encoded by Oracle as strings or numbers, including missing markers',
            items: {
              type: 'json',
              description: 'One documented string or numeric cell value',
            },
          },
        },
      },
    },
  },
}
