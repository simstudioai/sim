import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionProjectManagementResponse,
  OracleFusionUpdateProjectParams,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionProjectOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-patch.html
export const oracleFusionProjectManagementUpdateProjectTool: InternalToolConfig<
  OracleFusionUpdateProjectParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_update_project',
  name: 'Oracle Fusion Project Management Update Project',
  description: 'Update project in Oracle Fusion Cloud Project Management.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    projectId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Project ID as a decimal string',
    },
    projectName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project name',
    },
    projectNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project number',
    },
    projectDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project description (null is accepted by the documented API)',
    },
    projectStartDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project start date',
    },
    projectEndDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project end date (null is accepted by the documented API)',
    },
    projectStatusCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project status code (null is accepted by the documented API)',
    },
    projectStatusChangeComment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project status change comment (null is accepted by the documented API)',
    },
    projectManagerEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project manager email (null is accepted by the documented API)',
    },
    organizationName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Organization name',
    },
    projectCurrencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Project currency code',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    project: {
      type: 'json',
      description: 'Documented project fields',
      properties: oracleFusionProjectOutput,
    },
  },
}
