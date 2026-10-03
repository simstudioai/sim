import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleEpmDataResponse,
  OracleEpmDataSetPovLockParams,
} from '@/tools/oracle_epm_data/types'
import {
  ORACLE_EPM_DATA_MESSAGE_OUTPUTS,
  oracleEpmDataAuthParamFields,
  oracleEpmDataOAuth,
} from '@/tools/oracle_epm_data/utils'
import type { InternalToolConfig } from '@/tools/types'

export const oracleEpmDataSetPovLockTool: InternalToolConfig<
  OracleEpmDataSetPovLockParams,
  OracleEpmDataResponse
> = {
  id: 'oracle_epm_data_set_pov_lock',
  name: 'Oracle EPM Data Set POV Lock',
  description:
    'Lock or unlock a location/application POV; locking prevents associated data-load work.',
  version: '1.0.0',
  oauth: oracleEpmDataOAuth,
  params: {
    ...oracleEpmDataAuthParamFields,
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Data Integration POV period',
    },
    category: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Configured POV category',
    },
    lockType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'application or location',
    },
    lockOperation: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'lock or unlock',
    },
    application: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required when lockType is application',
    },
    locationName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Required when lockType is location',
    },
    unlockByLocation: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Application lock option allowing locations to be unlocked independently; Oracle default false',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: ORACLE_EPM_DATA_MESSAGE_OUTPUTS,
}
