import type { KnowledgeTriggerSyncResponse } from '@/tools/knowledge/types'
import type { ToolConfig } from '@/tools/types'

export const knowledgeTriggerSyncTool: ToolConfig<any, KnowledgeTriggerSyncResponse> = {
  id: 'knowledge_trigger_sync',
  name: 'Knowledge Trigger Sync',
  description: 'Trigger a manual sync for a knowledge base connector',
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
      description: 'ID of the connector to trigger sync for',
    },
  },

  request: {
    url: (params) =>
      `/api/knowledge/${params.knowledgeBaseId}/connectors/${params.connectorId}/sync`,
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response, params): Promise<KnowledgeTriggerSyncResponse> => {
    const result = await response.json()

    return {
      success: result.success ?? true,
      output: {
        connectorId: params?.connectorId ?? '',
        message: result.message ?? 'Sync triggered',
      },
    }
  },

  outputs: {
    connectorId: {
      type: 'string',
      description: 'ID of the connector that was synced',
    },
    message: {
      type: 'string',
      description: 'Status message from the sync trigger',
    },
  },
}
