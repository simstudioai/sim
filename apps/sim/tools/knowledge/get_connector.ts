import type { KnowledgeGetConnectorResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeGetConnectorTool: ToolConfig<any, KnowledgeGetConnectorResponse> = {
  id: 'knowledge_get_connector',
  name: 'Knowledge Get Connector',
  description:
    'Get detailed connector information including recent sync logs for monitoring sync health',
  version: '1.0.0',

  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the knowledge base the connector belongs to',
    },
    connectorId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the connector to retrieve',
    },
  },

  request: {
    url: (params) => `/api/knowledge/${params.knowledgeBaseId}/connectors/${params.connectorId}`,
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response): Promise<KnowledgeGetConnectorResponse> => {
    const result = await response.json()
    const data = result.data || {}

    return {
      success: result.success ?? true,
      output: {
        connector: {
          id: data.id,
          connectorType: data.connectorType,
          status: data.status,
          syncIntervalMinutes: data.syncIntervalMinutes,
          lastSyncAt: data.lastSyncAt ?? null,
          lastSyncError: data.lastSyncError ?? null,
          lastSyncDocCount: data.lastSyncDocCount ?? null,
          nextSyncAt: data.nextSyncAt ?? null,
          consecutiveFailures: data.consecutiveFailures ?? 0,
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
        },
        syncLogs: (data.syncLogs || []).map(
          (log: {
            id: string
            status: string
            startedAt: string | null
            completedAt: string | null
            docsAdded: number | null
            docsUpdated: number | null
            docsDeleted: number | null
            docsUnchanged: number | null
            errorMessage: string | null
          }) => ({
            id: log.id,
            status: log.status,
            startedAt: log.startedAt ?? null,
            completedAt: log.completedAt ?? null,
            docsAdded: log.docsAdded ?? null,
            docsUpdated: log.docsUpdated ?? null,
            docsDeleted: log.docsDeleted ?? null,
            docsUnchanged: log.docsUnchanged ?? null,
            errorMessage: log.errorMessage ?? null,
          })
        ),
      },
    }
  },

  outputs: {
    connector: {
      type: 'object',
      description: 'Connector details',
      properties: {
        id: { type: 'string', description: 'Connector ID' },
        connectorType: { type: 'string', description: 'Type of connector' },
        status: { type: 'string', description: 'Connector status (active, paused, syncing)' },
        syncIntervalMinutes: { type: 'number', description: 'Sync interval in minutes' },
        lastSyncAt: { type: 'string', description: 'Timestamp of last sync' },
        lastSyncError: { type: 'string', description: 'Error from last sync if failed' },
        lastSyncDocCount: { type: 'number', description: 'Docs synced in last sync' },
        nextSyncAt: { type: 'string', description: 'Next scheduled sync timestamp' },
        consecutiveFailures: { type: 'number', description: 'Consecutive sync failures' },
        createdAt: { type: 'string', description: 'Creation timestamp' },
        updatedAt: { type: 'string', description: 'Last update timestamp' },
      },
    },
    syncLogs: {
      type: 'array',
      description: 'Recent sync log entries',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Sync log ID' },
          status: { type: 'string', description: 'Sync status' },
          startedAt: { type: 'string', description: 'Sync start time' },
          completedAt: { type: 'string', description: 'Sync completion time' },
          docsAdded: { type: 'number', description: 'Documents added' },
          docsUpdated: { type: 'number', description: 'Documents updated' },
          docsDeleted: { type: 'number', description: 'Documents deleted' },
          docsUnchanged: { type: 'number', description: 'Documents unchanged' },
          errorMessage: { type: 'string', description: 'Error message if sync failed' },
        },
      },
    },
  },
}
