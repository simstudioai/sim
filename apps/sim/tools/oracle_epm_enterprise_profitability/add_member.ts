import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpcmAddMemberParams,
  OracleEpcmResponse,
} from '@/tools/oracle_epm_enterprise_profitability/types'
import { ORACLE_EPCM_ADD_MEMBER_OUTPUTS } from '@/tools/oracle_epm_enterprise_profitability/types'
import {
  oracleEpcmAuthParams,
  oracleEpcmOAuth,
} from '@/tools/oracle_epm_enterprise_profitability/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpcmAddMemberTool: InternalToolConfig<
  OracleEpcmAddMemberParams,
  OracleEpcmResponse
> = {
  id: 'oracle_epm_enterprise_profitability_add_member',
  name: 'Oracle EPCM Add Member',
  description:
    'Create a dynamic member under an eligible parent. The parent must allow dynamic children and the cube must have been refreshed.',
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
      description: 'New member name',
      visibility: 'user-or-llm',
    },
    parentName: {
      type: 'string',
      required: true,
      description: 'Parent enabled for dynamic children',
      visibility: 'user-or-llm',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPCM_ADD_MEMBER_OUTPUTS,
}
