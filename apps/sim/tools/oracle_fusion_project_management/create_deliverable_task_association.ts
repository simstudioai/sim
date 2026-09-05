import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionCreateDeliverableTaskAssociationParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionAssociationOutput,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-deliverableid-child-projecttaskassociation-post.html
export const oracleFusionProjectManagementCreateDeliverableTaskAssociationTool: InternalToolConfig<
  OracleFusionCreateDeliverableTaskAssociationParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_create_deliverable_task_association',
  name: 'Oracle Fusion Project Management Create Deliverable Task Association',
  description: 'Create deliverable task association in Oracle Fusion Cloud Project Management.',
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
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Project ID as an exact decimal ID string',
    },
    taskId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Task ID as an exact decimal ID string',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    association: {
      type: 'json',
      description: 'Documented association fields',
      properties: oracleFusionAssociationOutput,
    },
  },
}
