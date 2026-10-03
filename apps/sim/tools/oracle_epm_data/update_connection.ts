import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataResponse,
  OracleEpmDataUpdateConnectionParams,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_MESSAGE_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataUpdateConnectionTool: InternalToolConfig<
  OracleEpmDataUpdateConnectionParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_update_connection',
  name: 'Oracle EPM Data Update Connection',
  description:
    'Update an existing Data Integration connection using Oracle-encrypted secret option values.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    sourceSystemId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source-system ID returned by Get Connection',
    },
    sourceSystemName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source-system connection name',
    },
    sourceSystemType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Source-system type returned by Get Connection',
    },
    sourceSystemOptions: {
      type: 'json',
      required: true,
      visibility: 'user-only',
      description:
        'Array of {optionName, optionValue}. password, consumerSecret and tokenSecret require EPM Automate-encrypted .epw contents, not plaintext.',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_MESSAGE_OUTPUTS,
}
