import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataImportDataIntegrationParams,
  OracleEpmDataJobResponse,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_JOB_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataImportDataIntegrationTool: InternalToolConfig<
  OracleEpmDataImportDataIntegrationParams,
  OracleEpmDataJobResponse
> = {
  id: 'oracle_epm_data_import_data_integration',
  name: 'Oracle EPM Data Import Data Integration',
  description:
    'Restore a Data Integration snapshot, clearing existing target setup/staging data instead of merging.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    fileName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        "Uploaded inbox snapshot ZIP. A bare filename refers to the Data Integration root, which is populated only through Oracle's UI.",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_JOB_OUTPUTS,
}
