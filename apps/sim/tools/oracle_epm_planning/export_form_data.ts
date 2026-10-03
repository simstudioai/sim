import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmPlanningExportFormDataParams,
  OracleEpmPlanningResponse,
} from '@/tools/oracle_epm_planning/types'
import {
  oracleEpmPlanningAuthParamFields,
  oracleEpmPlanningParamFields,
} from '@/tools/oracle_epm_planning/utils'
import type { InternalToolConfig } from '@/tools/types'

/** Contract: https://docs.oracle.com/en/cloud/saas/enterprise-performance-management-common/prest/get_export_form_data.html */
export const oracleEpmPlanningExportFormDataTool: InternalToolConfig<
  OracleEpmPlanningExportFormDataParams,
  OracleEpmPlanningResponse
> = {
  id: 'oracle_epm_planning_export_form_data',
  name: 'Oracle EPM Planning Export Form Data',
  description:
    'Export a form’s numeric data and dimension layout using the form-specific response contract. Form ID or name is entered manually; page filtering is not exposed.',
  version: '1.0.0',
  params: {
    ...oracleEpmPlanningAuthParamFields,
    application: { ...oracleEpmPlanningParamFields.application, required: true },
    form: { ...oracleEpmPlanningParamFields.form, required: true },
    displayMemberAs: { ...oracleEpmPlanningParamFields.displayMemberAs, required: false },
    memberAliasDelimiter: { ...oracleEpmPlanningParamFields.memberAliasDelimiter, required: false },
    forceStartExpanded: { ...oracleEpmPlanningParamFields.forceStartExpanded, required: false },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    formData: {
      type: 'json',
      description: 'Form-specific numeric export',
      properties: {
        gridInfo: {
          type: 'json',
          description: 'Form layout',
          properties: {
            pageDimNames: {
              type: 'array',
              description: 'Page dimensions',
              items: {
                type: 'string',
              },
            },
            allowedPageMembersByDim: {
              type: 'object',
              description: 'Dimension names mapped to arrays of allowed member names',
            },
            rowDimNames: {
              type: 'array',
              description: 'Row dimensions',
              items: {
                type: 'string',
              },
            },
            columnDimNames: {
              type: 'array',
              description: 'Column dimensions',
              items: {
                type: 'string',
              },
            },
          },
        },
        pov: {
          type: 'object',
          description: 'POV dimension names mapped to member names',
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
          description: 'Numeric data rows',
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
                description: 'Numeric cell values',
                items: {
                  type: 'number',
                },
              },
            },
          },
        },
      },
    },
  },
}
