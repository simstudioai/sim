import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionDeleteProjectBudgetParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectbudgets-planversionid-delete.html
export const oracleFusionProjectManagementDeleteProjectBudgetTool: InternalToolConfig<
  OracleFusionDeleteProjectBudgetParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_delete_project_budget',
  name: 'Oracle Fusion Project Management Delete Project Budget',
  description: 'Delete project budget in Oracle Fusion Cloud Project Management.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    planVersionId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Plan version ID as a decimal string',
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
