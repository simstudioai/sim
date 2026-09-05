import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmListApplicationsParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_LIST_APPLICATIONS_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmListApplicationsTool: InternalToolConfig<
  OracleEpcmListApplicationsParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_list_applications',
  name: 'Oracle EPCM List Applications',
  description:
    'List applications accessible to the EPCM service account; no application-type enum is assumed.',
  version: '1.0.0',
  oauth: oracleEpcmOAuth,
  params: {
    ...oracleEpcmAuthParams,
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_LIST_APPLICATIONS_OUTPUTS,
}
