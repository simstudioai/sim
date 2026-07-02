import { filterUndefined } from '@sim/utils/object'
import type { LangsmithUpdateRunParams, LangsmithUpdateRunResponse } from '@/tools/langsmith/types'
import type { ToolConfig } from '@/tools/types'

export const langsmithUpdateRunTool: ToolConfig<
  LangsmithUpdateRunParams,
  LangsmithUpdateRunResponse
> = {
  id: 'langsmith_update_run',
  name: 'LangSmith Update Run',
  description: 'Patch an existing LangSmith run with outputs, status, or timing once it completes.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LangSmith API key',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the run to update',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Corrected run name',
    },
    end_time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run end time in ISO-8601 format',
    },
    outputs: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Outputs payload',
    },
    extra: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Additional metadata (extra)',
    },
    tags: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of tag strings',
    },
    status: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run status',
    },
    error: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Error details',
    },
    events: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Structured events array',
    },
  },
  request: {
    url: (params) => `https://api.smith.langchain.com/runs/${params.runId.trim()}`,
    method: 'PATCH',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const payload: Record<string, unknown> = {
        name: params.name,
        end_time: params.end_time,
        outputs: params.outputs,
        extra: params.extra,
        tags: params.tags,
        status: params.status,
        error: params.error,
        events: params.events,
      }

      return filterUndefined(payload)
    },
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LangSmith update run failed (${response.status}): ${errorText}`)
    }

    const responseText = await response.text()
    let message: string | null = null
    if (responseText) {
      try {
        const data = JSON.parse(responseText) as Record<string, unknown>
        message = typeof data.message === 'string' ? data.message : null
      } catch {
        // Response body isn't JSON (e.g. empty object or plain text) — no message to surface
      }
    }

    return {
      success: true,
      output: {
        accepted: true,
        runId: params?.runId.trim() ?? '',
        message,
      },
    }
  },
  outputs: {
    accepted: {
      type: 'boolean',
      description: 'Whether the run update was accepted',
    },
    runId: {
      type: 'string',
      description: 'ID of the run that was updated',
    },
    message: {
      type: 'string',
      description: 'Response message from LangSmith, if provided',
      optional: true,
    },
  },
}
