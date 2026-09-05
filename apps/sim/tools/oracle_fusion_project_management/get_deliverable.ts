import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetDeliverableParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionDeliverableOutput,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-get.html
export const oracleFusionProjectManagementGetDeliverableTool: InternalToolConfig<
  OracleFusionGetDeliverableParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_deliverable',
  name: 'Oracle Fusion Project Management Get Deliverable',
  description: 'Get deliverable in Oracle Fusion Cloud Project Management.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    deliverableId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Deliverable ID as a decimal string',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    deliverable: {
      type: 'json',
      description: 'Documented deliverable fields',
      properties: oracleFusionDeliverableOutput,
    },
  },
}
