/**
 * GENERATED — do not edit. Source of truth: the route files under apps/sim/app/api/v2.
 * Regenerate with `bun run generate:v2-route-table`; `check:v2-route-table` fails on drift.
 */

export interface V2RouteEntry {
  /** The URL pattern, with `{name}` for each dynamic segment. */
  pattern: string
  load: () => Promise<object>
}

export const V2_ROUTES: readonly V2RouteEntry[] = [
  {
    pattern: '/api/v2/{[...segments]}',
    load: () => import('@/app/api/v2/[[...segments]]/route'),
  },
  {
    pattern: '/api/v2/audit-logs',
    load: () => import('@/app/api/v2/audit-logs/route'),
  },
  {
    pattern: '/api/v2/audit-logs/{auditLogId}',
    load: () => import('@/app/api/v2/audit-logs/[auditLogId]/route'),
  },
  {
    pattern: '/api/v2/billing/logs',
    load: () => import('@/app/api/v2/billing/logs/route'),
  },
  {
    pattern: '/api/v2/billing/status',
    load: () => import('@/app/api/v2/billing/status/route'),
  },
  {
    pattern: '/api/v2/blocks',
    load: () => import('@/app/api/v2/blocks/route'),
  },
  {
    pattern: '/api/v2/blocks/{blockId}',
    load: () => import('@/app/api/v2/blocks/[blockId]/route'),
  },
  {
    pattern: '/api/v2/chat',
    load: () => import('@/app/api/v2/chat/route'),
  },
  {
    pattern: '/api/v2/chat-deployments',
    load: () => import('@/app/api/v2/chat-deployments/route'),
  },
  {
    pattern: '/api/v2/connector-types',
    load: () => import('@/app/api/v2/connector-types/route'),
  },
  {
    pattern: '/api/v2/credentials',
    load: () => import('@/app/api/v2/credentials/route'),
  },
  {
    pattern: '/api/v2/credentials/{credentialId}',
    load: () => import('@/app/api/v2/credentials/[credentialId]/route'),
  },
  {
    pattern: '/api/v2/credentials/connections',
    load: () => import('@/app/api/v2/credentials/connections/route'),
  },
  {
    pattern: '/api/v2/credentials/providers',
    load: () => import('@/app/api/v2/credentials/providers/route'),
  },
  {
    pattern: '/api/v2/custom-tools',
    load: () => import('@/app/api/v2/custom-tools/route'),
  },
  {
    pattern: '/api/v2/custom-tools/{customToolId}',
    load: () => import('@/app/api/v2/custom-tools/[customToolId]/route'),
  },
  {
    pattern: '/api/v2/files',
    load: () => import('@/app/api/v2/files/route'),
  },
  {
    pattern: '/api/v2/files/{fileId}',
    load: () => import('@/app/api/v2/files/[fileId]/route'),
  },
  {
    pattern: '/api/v2/files/{fileId}/content',
    load: () => import('@/app/api/v2/files/[fileId]/content/route'),
  },
  {
    pattern: '/api/v2/files/{fileId}/metadata',
    load: () => import('@/app/api/v2/files/[fileId]/metadata/route'),
  },
  {
    pattern: '/api/v2/files/{fileId}/restore',
    load: () => import('@/app/api/v2/files/[fileId]/restore/route'),
  },
  {
    pattern: '/api/v2/files/{fileId}/share',
    load: () => import('@/app/api/v2/files/[fileId]/share/route'),
  },
  {
    pattern: '/api/v2/files/{fileId}/text',
    load: () => import('@/app/api/v2/files/[fileId]/text/route'),
  },
  {
    pattern: '/api/v2/files/{fileId}/unzip',
    load: () => import('@/app/api/v2/files/[fileId]/unzip/route'),
  },
  {
    pattern: '/api/v2/files/bulk-delete',
    load: () => import('@/app/api/v2/files/bulk-delete/route'),
  },
  {
    pattern: '/api/v2/files/bulk-download',
    load: () => import('@/app/api/v2/files/bulk-download/route'),
  },
  {
    pattern: '/api/v2/files/folders',
    load: () => import('@/app/api/v2/files/folders/route'),
  },
  {
    pattern: '/api/v2/files/folders/restore',
    load: () => import('@/app/api/v2/files/folders/restore/route'),
  },
  {
    pattern: '/api/v2/files/move',
    load: () => import('@/app/api/v2/files/move/route'),
  },
  {
    pattern: '/api/v2/files/uploads',
    load: () => import('@/app/api/v2/files/uploads/route'),
  },
  {
    pattern: '/api/v2/files/uploads/{uploadId}',
    load: () => import('@/app/api/v2/files/uploads/[uploadId]/route'),
  },
  {
    pattern: '/api/v2/files/uploads/{uploadId}/complete',
    load: () => import('@/app/api/v2/files/uploads/[uploadId]/complete/route'),
  },
  {
    pattern: '/api/v2/files/uploads/{uploadId}/parts',
    load: () => import('@/app/api/v2/files/uploads/[uploadId]/parts/route'),
  },
  {
    pattern: '/api/v2/knowledge',
    load: () => import('@/app/api/v2/knowledge/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/connectors',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/connectors/{connectorId}',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/connectors/{connectorId}/documents',
    load: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/documents/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/connectors/{connectorId}/sync',
    load: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/connectors/[connectorId]/sync/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/documents',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/documents/{documentId}',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/documents/{documentId}/chunks',
    load: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/documents/{documentId}/chunks/{chunkId}',
    load: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/[documentId]/chunks/[chunkId]/route'
      ),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/documents/from-workspace-files',
    load: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/from-workspace-files/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/documents/uploads',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/documents/uploads/{uploadId}',
    load: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/documents/uploads/{uploadId}/complete',
    load: () =>
      import(
        '@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/complete/route'
      ),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/documents/uploads/{uploadId}/parts',
    load: () =>
      import('@/app/api/v2/knowledge/[knowledgeBaseId]/documents/uploads/[uploadId]/parts/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/restore',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/restore/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/tags',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/tags/{tagId}',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/[tagId]/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/tags/next-slot',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/next-slot/route'),
  },
  {
    pattern: '/api/v2/knowledge/{knowledgeBaseId}/tags/usage',
    load: () => import('@/app/api/v2/knowledge/[knowledgeBaseId]/tags/usage/route'),
  },
  {
    pattern: '/api/v2/knowledge/folders',
    load: () => import('@/app/api/v2/knowledge/folders/route'),
  },
  {
    pattern: '/api/v2/knowledge/search',
    load: () => import('@/app/api/v2/knowledge/search/route'),
  },
  {
    pattern: '/api/v2/logs',
    load: () => import('@/app/api/v2/logs/route'),
  },
  {
    pattern: '/api/v2/logs/{runId}',
    load: () => import('@/app/api/v2/logs/[runId]/route'),
  },
  {
    pattern: '/api/v2/logs/stats',
    load: () => import('@/app/api/v2/logs/stats/route'),
  },
  {
    pattern: '/api/v2/mcp-servers',
    load: () => import('@/app/api/v2/mcp-servers/route'),
  },
  {
    pattern: '/api/v2/mcp-servers/{mcpServerId}',
    load: () => import('@/app/api/v2/mcp-servers/[mcpServerId]/route'),
  },
  {
    pattern: '/api/v2/mcp-servers/{mcpServerId}/tools',
    load: () => import('@/app/api/v2/mcp-servers/[mcpServerId]/tools/route'),
  },
  {
    pattern: '/api/v2/meta',
    load: () => import('@/app/api/v2/meta/route'),
  },
  {
    pattern: '/api/v2/secrets',
    load: () => import('@/app/api/v2/secrets/route'),
  },
  {
    pattern: '/api/v2/secrets/{name}',
    load: () => import('@/app/api/v2/secrets/[name]/route'),
  },
  {
    pattern: '/api/v2/skills',
    load: () => import('@/app/api/v2/skills/route'),
  },
  {
    pattern: '/api/v2/skills/{skillId}',
    load: () => import('@/app/api/v2/skills/[skillId]/route'),
  },
  {
    pattern: '/api/v2/skills/{skillId}/editors',
    load: () => import('@/app/api/v2/skills/[skillId]/editors/route'),
  },
  {
    pattern: '/api/v2/tables',
    load: () => import('@/app/api/v2/tables/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}',
    load: () => import('@/app/api/v2/tables/[tableId]/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/cancel-runs',
    load: () => import('@/app/api/v2/tables/[tableId]/cancel-runs/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/columns',
    load: () => import('@/app/api/v2/tables/[tableId]/columns/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/dispatches',
    load: () => import('@/app/api/v2/tables/[tableId]/dispatches/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/dispatches/{dispatchId}',
    load: () => import('@/app/api/v2/tables/[tableId]/dispatches/[dispatchId]/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/exports',
    load: () => import('@/app/api/v2/tables/[tableId]/exports/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/exports/{exportId}',
    load: () => import('@/app/api/v2/tables/[tableId]/exports/[exportId]/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/exports/{exportId}/download',
    load: () => import('@/app/api/v2/tables/[tableId]/exports/[exportId]/download/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/groups',
    load: () => import('@/app/api/v2/tables/[tableId]/groups/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/query',
    load: () => import('@/app/api/v2/tables/[tableId]/query/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/query/count',
    load: () => import('@/app/api/v2/tables/[tableId]/query/count/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/restore',
    load: () => import('@/app/api/v2/tables/[tableId]/restore/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/rows',
    load: () => import('@/app/api/v2/tables/[tableId]/rows/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/rows/{rowId}',
    load: () => import('@/app/api/v2/tables/[tableId]/rows/[rowId]/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/rows/{rowId}/enrichment/{groupId}',
    load: () => import('@/app/api/v2/tables/[tableId]/rows/[rowId]/enrichment/[groupId]/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/rows/bulk-update',
    load: () => import('@/app/api/v2/tables/[tableId]/rows/bulk-update/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/rows/search',
    load: () => import('@/app/api/v2/tables/[tableId]/rows/search/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/rows/upsert',
    load: () => import('@/app/api/v2/tables/[tableId]/rows/upsert/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/views',
    load: () => import('@/app/api/v2/tables/[tableId]/views/route'),
  },
  {
    pattern: '/api/v2/tables/{tableId}/views/{viewId}',
    load: () => import('@/app/api/v2/tables/[tableId]/views/[viewId]/route'),
  },
  {
    pattern: '/api/v2/tables/bulk-delete',
    load: () => import('@/app/api/v2/tables/bulk-delete/route'),
  },
  {
    pattern: '/api/v2/tables/folders',
    load: () => import('@/app/api/v2/tables/folders/route'),
  },
  {
    pattern: '/api/v2/tables/folders/restore',
    load: () => import('@/app/api/v2/tables/folders/restore/route'),
  },
  {
    pattern: '/api/v2/tables/imports',
    load: () => import('@/app/api/v2/tables/imports/route'),
  },
  {
    pattern: '/api/v2/tables/imports/{importId}',
    load: () => import('@/app/api/v2/tables/imports/[importId]/route'),
  },
  {
    pattern: '/api/v2/tables/imports/{importId}/complete',
    load: () => import('@/app/api/v2/tables/imports/[importId]/complete/route'),
  },
  {
    pattern: '/api/v2/tables/imports/{importId}/parts',
    load: () => import('@/app/api/v2/tables/imports/[importId]/parts/route'),
  },
  {
    pattern: '/api/v2/tables/move',
    load: () => import('@/app/api/v2/tables/move/route'),
  },
  {
    pattern: '/api/v2/tools',
    load: () => import('@/app/api/v2/tools/route'),
  },
  {
    pattern: '/api/v2/tools/{toolId}',
    load: () => import('@/app/api/v2/tools/[toolId]/route'),
  },
  {
    pattern: '/api/v2/uploads/{uploadId}',
    load: () => import('@/app/api/v2/uploads/[uploadId]/route'),
  },
  {
    pattern: '/api/v2/uploads/{uploadId}/parts/{partNumber}',
    load: () => import('@/app/api/v2/uploads/[uploadId]/parts/[partNumber]/route'),
  },
  {
    pattern: '/api/v2/workflow-mcp-servers',
    load: () => import('@/app/api/v2/workflow-mcp-servers/route'),
  },
  {
    pattern: '/api/v2/workflow-mcp-servers/{serverId}',
    load: () => import('@/app/api/v2/workflow-mcp-servers/[serverId]/route'),
  },
  {
    pattern: '/api/v2/workflow-mcp-servers/{serverId}/tools',
    load: () => import('@/app/api/v2/workflow-mcp-servers/[serverId]/tools/route'),
  },
  {
    pattern: '/api/v2/workflow-mcp-servers/{serverId}/tools/{workflowId}',
    load: () => import('@/app/api/v2/workflow-mcp-servers/[serverId]/tools/[workflowId]/route'),
  },
  {
    pattern: '/api/v2/workflows',
    load: () => import('@/app/api/v2/workflows/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}',
    load: () => import('@/app/api/v2/workflows/[workflowId]/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/deploy',
    load: () => import('@/app/api/v2/workflows/[workflowId]/deploy/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/deployment',
    load: () => import('@/app/api/v2/workflows/[workflowId]/deployment/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/deployments/chat',
    load: () => import('@/app/api/v2/workflows/[workflowId]/deployments/chat/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/duplicate',
    load: () => import('@/app/api/v2/workflows/[workflowId]/duplicate/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/execute',
    load: () => import('@/app/api/v2/workflows/[workflowId]/execute/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/export',
    load: () => import('@/app/api/v2/workflows/[workflowId]/export/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/operations',
    load: () => import('@/app/api/v2/workflows/[workflowId]/operations/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/restore',
    load: () => import('@/app/api/v2/workflows/[workflowId]/restore/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/rollback',
    load: () => import('@/app/api/v2/workflows/[workflowId]/rollback/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/runs',
    load: () => import('@/app/api/v2/workflows/[workflowId]/runs/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/runs/{runId}',
    load: () => import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/runs/{runId}/cancel',
    load: () => import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/cancel/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/runs/{runId}/files/{fileId}',
    load: () => import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/files/[fileId]/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/runs/{runId}/resume',
    load: () => import('@/app/api/v2/workflows/[workflowId]/runs/[runId]/resume/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/state',
    load: () => import('@/app/api/v2/workflows/[workflowId]/state/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/variables',
    load: () => import('@/app/api/v2/workflows/[workflowId]/variables/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/versions',
    load: () => import('@/app/api/v2/workflows/[workflowId]/versions/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/versions/{version}',
    load: () => import('@/app/api/v2/workflows/[workflowId]/versions/[version]/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/versions/{version}/activate',
    load: () => import('@/app/api/v2/workflows/[workflowId]/versions/[version]/activate/route'),
  },
  {
    pattern: '/api/v2/workflows/{workflowId}/versions/{version}/revert',
    load: () => import('@/app/api/v2/workflows/[workflowId]/versions/[version]/revert/route'),
  },
  {
    pattern: '/api/v2/workflows/folders',
    load: () => import('@/app/api/v2/workflows/folders/route'),
  },
  {
    pattern: '/api/v2/workflows/import',
    load: () => import('@/app/api/v2/workflows/import/route'),
  },
  {
    pattern: '/api/v2/workflows/move',
    load: () => import('@/app/api/v2/workflows/move/route'),
  },
  {
    pattern: '/api/v2/workspaces',
    load: () => import('@/app/api/v2/workspaces/route'),
  },
  {
    pattern: '/api/v2/workspaces/{workspaceId}',
    load: () => import('@/app/api/v2/workspaces/[workspaceId]/route'),
  },
  {
    pattern: '/api/v2/workspaces/{workspaceId}/members',
    load: () => import('@/app/api/v2/workspaces/[workspaceId]/members/route'),
  },
]
