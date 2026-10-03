import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmGetMemberParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_ADD_MEMBER_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmGetMemberTool: InternalToolConfig<
  OracleEpcmGetMemberParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_get_member',
  name: 'Oracle EPCM Get Member',
  description:
    'Read documented properties of one member; this does not list dimensions or descendants.',
  version: '1.0.0',
  oauth: oracleEpcmOAuth,
  params: {
    ...oracleEpcmAuthParams,

    applicationName: {
      type: 'string',
      required: true,
      description: 'Exact EPCM application name',
      visibility: 'user-or-llm',
    },
    dimensionName: {
      type: 'string',
      required: true,
      description: 'Exact dimension name',
      visibility: 'user-or-llm',
    },
    memberName: {
      type: 'string',
      required: true,
      description: 'Exact member name',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_ADD_MEMBER_OUTPUTS,
}
