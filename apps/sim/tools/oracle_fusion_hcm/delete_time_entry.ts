import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_DELETE_TIME_ENTRY_OUTPUTS,
  type OracleFusionHcmDeleteTimeEntryParams,
  type OracleFusionHcmDeleteTimeEntryResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmDeleteTimeEntryTool: InternalToolConfig<
  OracleFusionHcmDeleteTimeEntryParams,
  OracleFusionHcmDeleteTimeEntryResponse
> = {
  id: 'oracle_fusion_hcm_delete_time_entry',
  name: 'Delete Time Entry in Oracle Fusion HCM',
  description:
    'Submit one asynchronous delete time-entry intake request. Acceptance is not processing completion, approval, or payroll transfer; inspect request events and messages afterward.',
  ...internalExecution,
  params: {
    ...common,
    personNumber: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Worker person number, including any leading zeros; does not require current public-directory membership',
    },
    assignmentNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HR assignment number',
    },
    timeRecordId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Time record ID, as a positive decimal string',
    },
    timeRecordVersion: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Current time-record version from get_time_record; required for update and delete',
    },
    processMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'TIME_ENTER (default), TIME_SAVE, or TIME_SUBMIT. Requests process asynchronously; acceptance is not completion or approval',
    },
    changeReason: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tenant-configured audit change reason code',
    },
  },
  outputs: ORACLE_FUSION_HCM_DELETE_TIME_ENTRY_OUTPUTS,
}
