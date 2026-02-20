import type {
  AlgoliaUpdateSettingsParams,
  AlgoliaUpdateSettingsResponse,
} from '@/tools/algolia/types'
import type { ToolConfig } from '@/tools/types'

export const updateSettingsTool: ToolConfig<
  AlgoliaUpdateSettingsParams,
  AlgoliaUpdateSettingsResponse
> = {
  id: 'algolia_update_settings',
  name: 'Algolia Update Settings',
  description: 'Update the settings of an Algolia index',
  version: '1.0',

  params: {
    applicationId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia Application ID',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Algolia Admin API Key (must have editSettings ACL)',
    },
    indexName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the Algolia index',
    },
    settings: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'JSON object with settings to update (e.g., {"searchableAttributes": ["name", "description"], "customRanking": ["desc(popularity)"]})',
    },
    forwardToReplicas: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to apply changes to replica indices (default: false)',
    },
  },

  request: {
    url: (params) => {
      const base = `https://${params.applicationId}.algolia.net/1/indexes/${encodeURIComponent(params.indexName)}/settings`
      if (params.forwardToReplicas) {
        return `${base}?forwardToReplicas=true`
      }
      return base
    },
    method: 'PUT',
    headers: (params) => ({
      'x-algolia-application-id': params.applicationId,
      'x-algolia-api-key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const settings =
        typeof params.settings === 'string' ? JSON.parse(params.settings) : params.settings
      return settings
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        taskID: data.taskID ?? 0,
        updatedAt: data.updatedAt ?? null,
      },
    }
  },

  outputs: {
    taskID: {
      type: 'number',
      description: 'Algolia task ID for tracking the settings update',
    },
    updatedAt: {
      type: 'string',
      description: 'Timestamp when the settings were updated',
      optional: true,
    },
  },
}
