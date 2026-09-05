import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENT_TASKS_OUTPUTS,
  type OracleFusionHcmListPerformanceDocumentTasksParams,
  type OracleFusionHcmListPerformanceDocumentTasksResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPerformanceDocumentTasksTool: InternalToolConfig<
  OracleFusionHcmListPerformanceDocumentTasksParams,
  OracleFusionHcmListPerformanceDocumentTasksResponse
> = {
  id: 'oracle_fusion_hcm_list_performance_document_tasks',
  name: 'List Performance Document Tasks in Oracle Fusion HCM',
  description: 'Read one page of performance document tasks from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    evaluationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Evaluation ID, as a positive decimal string',
    },
    evalRoleId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Eval role ID, as a positive decimal string',
    },
    evalParticipantId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Eval participant ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENT_TASKS_OUTPUTS,
}
