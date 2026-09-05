import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionListProjectStatusHistoryParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionHistoryOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projects-projectid-child-projectstatushistory-get.html
export const oracleFusionProjectManagementListProjectStatusHistoryTool: InternalToolConfig<
  OracleFusionListProjectStatusHistoryParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_list_project_status_history',
  name: 'Oracle Fusion Project Management List Project Status History',
  description: "List project status history in Oracle Fusion Cloud Project Management. Returns one bounded page, not an automatically drained collection.",
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
    q: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Optional Oracle q filter using attributes documented for this collection",
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: "Oracle sort attributes, for example ProjectId:asc; use a stable order when paging",
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 100,
      description: "One page of 1–1000 items; default 100",
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      default: 0,
      description: "Zero-based offset for this page; use nextOffset to continue",
    },
    totalResults: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: "Include Oracle’s estimated total row count",
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: { type: 'array', description: 'This page of history records', items: { type: 'object', properties: oracleFusionHistoryOutput } },
    count: { type: 'number', description: 'Items in this page' },
    hasMore: { type: 'boolean', description: 'Whether Oracle reports another page' },
    limit: { type: 'number', description: 'Page size used by Oracle' },
    offset: { type: 'number', description: 'Offset used for this page' },
    nextOffset: { type: 'number', description: 'Offset to request next when hasMore is true' },
    totalResults: { type: 'number', description: 'Estimated total when requested', optional: true },
  },
}
