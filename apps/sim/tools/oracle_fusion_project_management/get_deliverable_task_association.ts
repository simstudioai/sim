import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetDeliverableTaskAssociationParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionAssociationOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-child-projecttaskassociation-objectassociationid-get.html
export const oracleFusionProjectManagementGetDeliverableTaskAssociationTool: InternalToolConfig<
  OracleFusionGetDeliverableTaskAssociationParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_deliverable_task_association',
  name: 'Oracle Fusion Project Management Get Deliverable Task Association',
  description: "Get deliverable task association in Oracle Fusion Cloud Project Management.",
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    deliverableId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "deliverable ID as a decimal string",
    },
    associationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "association ID as a decimal string",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    association: { type: 'json', description: 'Documented association fields', properties: oracleFusionAssociationOutput },
  },
}
