import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_TIME_RECORDS_OUTPUTS,
  type OracleFusionHcmListTimeRecordsParams,
  type OracleFusionHcmListTimeRecordsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListTimeRecordsTool: InternalToolConfig<
  OracleFusionHcmListTimeRecordsParams,
  OracleFusionHcmListTimeRecordsResponse
> = {
  id: 'oracle_fusion_hcm_list_time_records',
  name: 'List Time Records in Oracle Fusion HCM',
  description: 'Read one page of time records from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
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
  outputs: ORACLE_FUSION_HCM_LIST_TIME_RECORDS_OUTPUTS,
}
