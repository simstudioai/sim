import { common, internalExecution, timeAttributeItems } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_CREATE_TIME_ENTRY_OUTPUTS,
  type OracleFusionHcmCreateTimeEntryParams,
  type OracleFusionHcmCreateTimeEntryResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmCreateTimeEntryTool: InternalToolConfig<
  OracleFusionHcmCreateTimeEntryParams,
  OracleFusionHcmCreateTimeEntryResponse
> = {
  id: 'oracle_fusion_hcm_create_time_entry',
  name: 'Create Time Entry in Oracle Fusion HCM',
  description:
    'Submit one asynchronous create time-entry intake request. Acceptance is not processing completion, approval, or payroll transfer; inspect request events and messages afterward.',
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
    startTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start timestamp in ISO 8601 with explicit time-zone offset',
    },
    stopTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stop timestamp in ISO 8601 with explicit time-zone offset',
    },
    measure: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Positive quantity in hours or units; may accompany startTime and stopTime',
    },
    referenceDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional processing date for entries spanning multiple days (YYYY-MM-DD)',
    },
    payrollTimeType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'PayrollTimeType attribute value discovered for the assignment and effective date',
    },
    timeAttributes: {
      type: 'array',
      items: timeAttributeItems,
      minItems: 0,
      maxItems: 30,
      required: false,
      visibility: 'user-or-llm',
      description:
        'Up to 30 typed {attributeName, attributeValue} qualifiers discovered through the time configuration tools. PayrollTimeType uses its dedicated input',
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
  outputs: ORACLE_FUSION_HCM_CREATE_TIME_ENTRY_OUTPUTS,
}
