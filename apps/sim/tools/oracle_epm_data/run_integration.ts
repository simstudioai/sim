import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataRunIntegrationParams,
  OracleEpmDataSubmissionResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_SUBMISSION_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataRunIntegrationTool: InternalToolConfig<
  OracleEpmDataRunIntegrationParams,
  OracleEpmDataSubmissionResponse
> = {
  id: 'oracle_epm_data_run_integration',
  name: 'Oracle EPM Data Run Integration',
  description:
    'Submit an existing integration and return uninterpreted Oracle JSON, without inferring acceptance or completion.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    jobName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing Data Integration integration name',
    },
    periodName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Oracle period expression, for example {Jan-20}, {Jan-20}{Mar-20}, {Jan#FY20}, or {GLOBAL_POV}',
    },
    importMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Import mode supported by this integration: Append, Replace, Map and Validate, No Import, or Direct',
    },
    exportMode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Export mode supported by the target and load method: Merge, Replace, Accumulate, Subtract, or No Export',
    },
    fileName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Optional source filename already uploaded to inbox, or #epminbox/<filename>; omission uses the integration definition',
    },
    executionMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'SYNC or ASYNC; mandatory for Quick Mode only. Oracle SYNC may wait server-side; Sim does not poll this submission.',
    },
    sourceFilters: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tenant-defined English source filter names and string values. Unsupported for native file-based loads.',
    },
    targetOptions: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tenant-defined English target option names and string values',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_SUBMISSION_OUTPUTS,
}
