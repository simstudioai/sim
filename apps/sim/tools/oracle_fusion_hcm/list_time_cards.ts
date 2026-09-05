import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TIME_CARDS_OUTPUTS,
  type OracleFusionHcmListTimeCardsParams,
  type OracleFusionHcmListTimeCardsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTimeCardsTool: InternalToolConfig<
  OracleFusionHcmListTimeCardsParams,
  OracleFusionHcmListTimeCardsResponse
> = {
  id: 'oracle_fusion_hcm_list_time_cards',
  name: 'List Time Cards in Oracle Fusion HCM',
  description: 'Read one page of time cards from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    personNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Worker person number, including any leading zeros; does not require current public-directory membership',
    },
    startTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start timestamp in ISO 8601 with explicit time-zone offset',
    },
    stopTime: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Stop timestamp in ISO 8601 with explicit time-zone offset',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_TIME_CARDS_OUTPUTS,
}
