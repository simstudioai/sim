import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataExecuteReportParams,
  OracleEpmDataJobResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_JOB_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataExecuteReportTool: InternalToolConfig<
  OracleEpmDataExecuteReportParams,
  OracleEpmDataJobResponse
> = {
  id: 'oracle_epm_data_execute_report',
  name: 'Oracle EPM Data Execute Report',
  description:
    'Run an existing Data Management report and return its job and repository output information.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    jobName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing Data Management report name',
    },
    reportFormatType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'PDF, XLSX, HTML, or EXCEL',
    },
    parameters: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Report-specific parameter names and string values, such as Dimension Name, Category, Period, and Location',
    },
    waitForCompletion: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Wait up to five minutes for this documented job to finish; default false. Timeout preserves the job ID and never resubmits.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_JOB_OUTPUTS,
}
