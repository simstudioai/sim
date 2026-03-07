import type { KnowledgeListConnectorsResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeListConnectorsTool: ToolConfig<any, KnowledgeListConnectorsResponse> = {
  id: 'knowledge_list_connectors',
  name: 'Knowledge List Connectors',
  description:
    'List all connectors for a knowledge base, showing sync status, type, and document counts',
  version: '1.0.0',

  params: {
    knowledgeBaseId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the knowledge base to list connectors for',
    },
  },

  request: {
    url: (params) => `/api/knowledge/${params.knowledgeBaseId}/connectors`,
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params): Promise<KnowledgeListConnectorsResponse> => {
    const result = await response.json()
    const connectors = result.data || []

    return {
      success: result.success ?? true,
      output: {
        knowledgeBaseId: params?.knowledgeBaseId ?? '',
        connectors: connectors.map(
          (c: {
            id: string
            connectorType: string
            status: string
            syncIntervalMinutes: number
            lastSyncAt: string | null
            lastSyncError: string | null
            lastSyncDocCount: number | null
            nextSyncAt: string | null
            consecutiveFailures: number
            createdAt: string | null
            updatedAt: string | null
          }) => ({
            id: c.id,
            connectorType: c.connectorType,
            status: c.status,
            syncIntervalMinutes: c.syncIntervalMinutes,
            lastSyncAt: c.lastSyncAt ?? null,
            lastSyncError: c.lastSyncError ?? null,
            lastSyncDocCount: c.lastSyncDocCount ?? null,
            nextSyncAt: c.nextSyncAt ?? null,
            consecutiveFailures: c.consecutiveFailures ?? 0,
            createdAt: c.createdAt ?? null,
            updatedAt: c.updatedAt ?? null,
          })
        ),
        totalConnectors: connectors.length,
      },
    }
  },

  outputs: {
    knowledgeBaseId: {
      type: 'string',
      description: 'ID of the knowledge base',
    },
    connectors: {
      type: 'array',
      description: 'Array of connectors for the knowledge base',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Connector ID' },
          connectorType: {
            type: 'string',
            description: 'Type of connector (e.g. notion, github, confluence)',
          },
          status: {
            type: 'string',
            description: 'Connector status (active, paused, syncing)',
          },
          syncIntervalMinutes: {
            type: 'number',
            description: 'Sync interval in minutes (0 = manual only)',
          },
          lastSyncAt: { type: 'string', description: 'Timestamp of last sync' },
          lastSyncError: { type: 'string', description: 'Error from last sync if failed' },
          lastSyncDocCount: {
            type: 'number',
            description: 'Number of documents synced in last sync',
          },
          nextSyncAt: { type: 'string', description: 'Timestamp of next scheduled sync' },
          consecutiveFailures: {
            type: 'number',
            description: 'Number of consecutive sync failures',
          },
          createdAt: { type: 'string', description: 'Creation timestamp' },
          updatedAt: { type: 'string', description: 'Last update timestamp' },
        },
      },
    },
    totalConnectors: {
      type: 'number',
      description: 'Total number of connectors',
    },
  },
}
