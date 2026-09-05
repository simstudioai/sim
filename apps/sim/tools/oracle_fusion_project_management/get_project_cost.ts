import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetProjectCostParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionCostOutput,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectcosts-projectcostsuniqid-get.html
export const oracleFusionProjectManagementGetProjectCostTool: InternalToolConfig<
  OracleFusionGetProjectCostParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_project_cost',
  name: 'Oracle Fusion Project Management Get Project Cost',
  description: 'Get project cost in Oracle Fusion Cloud Project Management.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    costKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Opaque project-cost key returned by list or get; not the numeric costId',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    cost: {
      type: 'json',
      description: 'Documented cost fields',
      properties: oracleFusionCostOutput,
    },
  },
}
