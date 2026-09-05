import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataImportMappingsParams,
  OracleEpmDataJobResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_JOB_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataImportMappingsTool: InternalToolConfig<
  OracleEpmDataImportMappingsParams,
  OracleEpmDataJobResponse
> = {
  id: 'oracle_epm_data_import_mappings',
  name: 'Oracle EPM Data Import Mappings',
  description:
    'Import member mappings from an uploaded file, optionally replacing existing mappings.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    dimension: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Dimension name, or ALL for all dimensions',
    },
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Existing inbox .CSV, .TXT, .XLS, or .XLSX mapping filename',
    },
    importMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'MERGE (Oracle default) or REPLACE, which clears existing mapping rules',
    },
    validationMode: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Validate target members against the target application; Oracle default false',
    },
    locationName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Location where mappings should be loaded',
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
