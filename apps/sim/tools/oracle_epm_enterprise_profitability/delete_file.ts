import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmDeleteFileParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_DELETE_FILE_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmDeleteFileTool: InternalToolConfig<
  OracleEpcmDeleteFileParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_delete_file',
  name: 'Oracle EPCM Delete File',
  description:
    'Delete one ordinary EXTERNAL repository file after verifying its type. LCM snapshots are excluded.',
  version: '1.0.0',
  oauth: oracleEpcmOAuth,
  params: {
    ...oracleEpcmAuthParams,

    fileName: {
      type: 'string',
      required: true,
      description: 'Raw repository filename, including ordinary folders; do not URL-encode it',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_DELETE_FILE_OUTPUTS,
}
