import type { ToolConfig } from '@/tools/types'
import type { ObsidianGetPeriodicNoteParams, ObsidianGetPeriodicNoteResponse } from './types'

export const getPeriodicNoteTool: ToolConfig<
  ObsidianGetPeriodicNoteParams,
  ObsidianGetPeriodicNoteResponse
> = {
  id: 'obsidian_get_periodic_note',
  name: 'Obsidian Get Periodic Note',
  description: 'Retrieve the current periodic note (daily, weekly, monthly, quarterly, or yearly)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'API key from Obsidian Local REST API plugin settings',
    },
    baseUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Base URL for the Obsidian Local REST API',
    },
    period: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Period type: daily, weekly, monthly, quarterly, or yearly',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/periodic/${encodeURIComponent(params.period)}/`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'text/markdown',
    }),
  },

  transformResponse: async (response, params) => {
    const content = await response.text()
    return {
      success: true,
      output: {
        content,
        period: params?.period ?? '',
      },
    }
  },

  outputs: {
    content: {
      type: 'string',
      description: 'Markdown content of the periodic note',
    },
    period: {
      type: 'string',
      description: 'Period type of the note',
    },
  },
}
