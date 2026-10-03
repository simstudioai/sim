import { internalExecution, listCommon } from '@/tools/oracle_fusion_hcm/common'
import {
  ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENT_ROLES_OUTPUTS,
  type OracleFusionHcmListPerformanceDocumentRolesParams,
  type OracleFusionHcmListPerformanceDocumentRolesResponse,
} from '@/tools/oracle_fusion_hcm/types'
import type { InternalToolConfig } from '@/tools/types'

export const oracleFusionHcmListPerformanceDocumentRolesTool: InternalToolConfig<
  OracleFusionHcmListPerformanceDocumentRolesParams,
  OracleFusionHcmListPerformanceDocumentRolesResponse
> = {
  id: 'oracle_fusion_hcm_list_performance_document_roles',
  name: 'List Performance Document Roles in Oracle Fusion HCM',
  description:
    'Read one page of performance document roles from Oracle Fusion HCM. Requires the corresponding tenant module and data access.',
  ...internalExecution,
  params: {
    ...listCommon,
    evaluationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Evaluation ID, as a positive decimal string',
    },
  },
  outputs: ORACLE_FUSION_HCM_LIST_PERFORMANCE_DOCUMENT_ROLES_OUTPUTS,
}
