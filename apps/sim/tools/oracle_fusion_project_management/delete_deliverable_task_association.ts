import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionDeleteDeliverableTaskAssociationParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-child-projecttaskassociation-objectassociationid-delete.html
export const oracleFusionProjectManagementDeleteDeliverableTaskAssociationTool: InternalToolConfig<
  OracleFusionDeleteDeliverableTaskAssociationParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_delete_deliverable_task_association',
  name: 'Oracle Fusion Project Management Delete Deliverable Task Association',
  description: 'Delete deliverable task association in Oracle Fusion Cloud Project Management.',
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
    associationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Association ID as a decimal string',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    deleted: {
      type: 'boolean',
      description: 'True after Oracle accepts the deletion with an empty success response',
    },
    id: { type: 'string', description: 'Identifier supplied to this delete operation' },
  },
}
