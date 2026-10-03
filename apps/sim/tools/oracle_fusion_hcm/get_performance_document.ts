import { common, internalExecution } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_GET_PERFORMANCE_DOCUMENT_OUTPUTS,
  type OracleFusionHcmGetPerformanceDocumentParams,
  type OracleFusionHcmGetPerformanceDocumentResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmGetPerformanceDocumentTool: InternalToolConfig<
  OracleFusionHcmGetPerformanceDocumentParams,
  OracleFusionHcmGetPerformanceDocumentResponse
> = {
  id: 'oracle_fusion_hcm_get_performance_document',
  name: 'Get Performance Document in Oracle Fusion HCM',
  description:
    'Read an Oracle Fusion HCM performance document by its documented ID, subject to tenant data access.',
  ...internalExecution,
  params: {
    ...common,
    evaluationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Evaluation ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_GET_PERFORMANCE_DOCUMENT_OUTPUTS,
}
