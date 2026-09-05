import { listCommon, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENT_PARTICIPANTS_OUTPUTS,
  type OracleFusionHcmListPerformanceDocumentParticipantsParams,
  type OracleFusionHcmListPerformanceDocumentParticipantsResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPerformanceDocumentParticipantsTool: InternalToolConfig<
  OracleFusionHcmListPerformanceDocumentParticipantsParams,
  OracleFusionHcmListPerformanceDocumentParticipantsResponse
> = {
  id: 'oracle_fusion_hcm_list_performance_document_participants',
  name: 'List Performance Document Participants in Oracle Fusion HCM',
  description: 'Read one page of performance document participants from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
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
  },
  outputs: ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENT_PARTICIPANTS_OUTPUTS,
}
