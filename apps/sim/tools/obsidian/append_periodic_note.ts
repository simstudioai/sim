import type { ToolConfig } from '@/tools/types'
import type { ObsidianAppendPeriodicNoteParams, ObsidianAppendPeriodicNoteResponse } from './types'

export const appendPeriodicNoteTool: ToolConfig<
  ObsidianAppendPeriodicNoteParams,
  ObsidianAppendPeriodicNoteResponse
> = {
  id: 'obsidian_append_periodic_note',
  name: 'Obsidian Append to Periodic Note',
  description:
    'Append content to the current periodic note (daily, weekly, monthly, quarterly, or yearly). Creates the note if it does not exist.',
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
    content: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Markdown content to append to the periodic note',
    },
  },

  request: {
    url: (params) => {
      const base = params.baseUrl.replace(/\/$/, '')
      return `${base}/periodic/${encodeURIComponent(params.period)}/`
    },
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'text/markdown',
    }),
    body: (params) => params.content,
  },

  transformResponse: async (response, params) => {
    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: 'Unknown error' }))
      throw new Error(`Failed to append to periodic note: ${error.message ?? response.statusText}`)
    }
    return {
      success: true,
      output: {
        period: params?.period ?? '',
        appended: true,
      },
    }
  },

  outputs: {
    period: {
      type: 'string',
      description: 'Period type of the note',
    },
    appended: {
      type: 'boolean',
      description: 'Whether content was successfully appended',
    },
  },
}
