import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataExportMappingsParams,
  OracleEpmDataJobResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_JOB_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataExportMappingsTool: InternalToolConfig<
  OracleEpmDataExportMappingsParams,
  OracleEpmDataJobResponse
> = {
  id: 'oracle_epm_data_export_mappings',
  name: 'Oracle EPM Data Export Mappings',
  description: "Export a location's member mappings to a repository file.",
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
      description: 'Destination outbox filename; the extension selects .CSV, .TXT, or .XLS format',
    },
    locationName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Location whose mapping rules should be exported',
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
