import { createInternalToolOperationInput } from '@/tools/operation-input'
import type {
  OracleFusionListProjectStatusesParams,
  OracleFusionProjectManagementResponse,
} from '@/tools/oracle_fusion_project_management/types'
import {
  ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  oracleFusionProjectManagementAuthParams,
  oracleFusionStatusOutput,
} from '@/tools/oracle_fusion_project_management/utils'
import type { InternalToolConfig } from '@/tools/types'

// https://docs.oracle.com/en/cloud/saas/project-management/26c/fapap/op-projectstatuseslov-get.html
export const oracleFusionProjectManagementListProjectStatusesTool: InternalToolConfig<
  OracleFusionListProjectStatusesParams,
  OracleFusionProjectManagementResponse
> = {
  id: 'oracle_fusion_project_management_list_project_statuses',
  name: 'Oracle Fusion Project Management List Project Statuses',
  description:
    'Read statuses for projects and other status-enabled business objects. Use StatusObjectCode to distinguish them; configured transitions and privileges remain tenant-specific.',
  version: '1.0.0',
  oauth: ORACLE_FUSION_PROJECT_MANAGEMENT_OAUTH_CONFIG,
  params: {
    ...oracleFusionProjectManagementAuthParams,
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
    statusObjectCode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Tenant status-object code; omit to inspect all status-enabled project business objects',
    },
  },
  operation: { input: createInternalToolOperationInput },
  outputs: {
    items: {
      type: 'array',
      description: 'This page of status records',
      items: { type: 'object', properties: oracleFusionStatusOutput },
    },
    count: { type: 'number', description: 'Items in this page' },
    hasMore: { type: 'boolean', description: 'Whether Oracle reports another page' },
    limit: { type: 'number', description: 'Page size used by Oracle' },
    offset: { type: 'number', description: 'Offset used for this page' },
    nextOffset: { type: 'number', description: 'Offset to request next when hasMore is true' },
    totalResults: { type: 'number', description: 'Estimated total when requested', optional: true },
  },
}
