import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionListTaskLaborResourceAssignmentsParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionLaborAssignmentOutput,
  oracleFusionProjectManagementAuthParams,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectplans-projectid-child-tasklaborresourceassignments-get.html
export const oracleFusionProjectManagementListTaskLaborResourceAssignmentsTool: InternalToolConfig<
  OracleFusionListTaskLaborResourceAssignmentsParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_list_task_labor_resource_assignments',
  name: 'Oracle Fusion Project Management List Task Labor Resource Assignments',
  description:
    'List task labor resource assignments in Oracle Fusion Cloud Project Management. Returns one bounded page, not an automatically drained collection.',
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
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional oracle q filter using attributes documented for this collection',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Documented sort attributes for this collection, for example TaskId:asc for tasks; use a stable order when paging',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 100,
      description: 'One page of 1–1000 items; default 100',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: 'Zero-based offset for this page; use nextOffset to continue',
    },
    totalResults: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include oracle’s estimated total row count',
    },
    taskId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter assignments by a task within the selected project',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'This page of labor Assignment records',
      items: { type: 'object', properties: oracleFusionLaborAssignmentOutput },
    },
    count: { type: 'number', description: 'Items in this page' },
    hasMore: { type: 'boolean', description: 'Whether Oracle reports another page' },
    limit: { type: 'number', description: 'Page size used by Oracle' },
    offset: { type: 'number', description: 'Offset used for this page' },
    nextOffset: { type: 'number', description: 'Offset to request next when hasMore is true' },
    totalResults: { type: 'number', description: 'Estimated total when requested', optional: true },
  },
}
