import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionGetProjectParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionProjectOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-get.html
export const oracleFusionProjectManagementGetProjectTool: InternalToolConfig<
  OracleFusionGetProjectParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_get_project',
  name: 'Oracle Fusion Project Management Get Project',
  description: "Get project in Oracle Fusion Cloud Project Management.",
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "project ID as a decimal string",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    project: { type: 'json', description: 'Documented project fields', properties: oracleFusionProjectOutput },
  },
}
