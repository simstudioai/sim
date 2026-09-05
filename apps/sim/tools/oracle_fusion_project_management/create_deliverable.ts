import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionCreateDeliverableParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionDeliverableOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-deliverables-post.html
export const oracleFusionProjectManagementCreateDeliverableTool: InternalToolConfig<
  OracleFusionCreateDeliverableParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_create_deliverable',
  name: 'Oracle Fusion Project Management Create Deliverable',
  description: "Create deliverable in Oracle Fusion Cloud Project Management.",
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
    deliverableName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "deliverable Name",
    },
    shortName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "short Name",
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "description (null is accepted by the documented API)",
    },
    needByDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "need By Date (null is accepted by the documented API)",
    },
    ownerEmail: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "owner Email (null is accepted by the documented API)",
    },
    deliverablePriorityCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "deliverable Priority Code",
    },
    deliverableStatusCode: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "deliverable Status Code",
    },
    deliverableTypeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "deliverable Type ID as an exact decimal ID string",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    deliverable: { type: 'json', description: 'Documented deliverable fields', properties: oracleFusionDeliverableOutput },
  },
}
