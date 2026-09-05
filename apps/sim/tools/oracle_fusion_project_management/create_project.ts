import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionCreateProjectParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionProjectOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-post.html
export const oracleFusionProjectManagementCreateProjectTool: InternalToolConfig<
  OracleFusionCreateProjectParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_create_project',
  name: 'Oracle Fusion Project Management Create Project',
  description: "Create project in Oracle Fusion Cloud Project Management.",
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    projectName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "project Name",
    },
    projectNumber: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "project Number",
    },
    projectDescription: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "project Description (null is accepted by the documented API)",
    },
    projectStartDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "project Start Date",
    },
    projectEndDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "project End Date (null is accepted by the documented API)",
    },
    projectStatusCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "project Status Code (null is accepted by the documented API)",
    },
    projectStatusChangeComment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "project Status Change Comment (null is accepted by the documented API)",
    },
    projectManagerEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "project Manager Email (null is accepted by the documented API)",
    },
    organizationName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "organization Name",
    },
    projectCurrencyCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "project Currency Code",
    },
    sourceTemplateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "source Template ID as an exact decimal ID string (null is accepted by the documented API)",
    },
    sourceTemplateName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "source Template Name (null is accepted by the documented API)",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    project: { type: 'json', description: 'Documented project fields', properties: oracleFusionProjectOutput },
  },
}
