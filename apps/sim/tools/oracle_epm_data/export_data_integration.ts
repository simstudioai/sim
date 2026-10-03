import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataExportDataIntegrationParams,
  OracleEpmDataJobResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_JOB_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataExportDataIntegrationTool: InternalToolConfig<
  OracleEpmDataExportDataIntegrationParams,
  OracleEpmDataJobResponse
> = {
  id: 'oracle_epm_data_export_data_integration',
  name: 'Oracle EPM Data Export Data Integration',
  description: 'Back up Data Integration setup and staging data to a snapshot in outbox.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Output snapshot filename; Oracle generates it in outbox and appends .zip if necessary',
    },
    snapshotType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ALL, ALL_INCREMENTAL, INCREMENTAL, or SETUP',
    },
    overwriteFile: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Replace an existing output snapshot; default false',
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
