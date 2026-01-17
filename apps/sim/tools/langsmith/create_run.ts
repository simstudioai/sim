import type { LangsmithCreateRunParams, LangsmithCreateRunResponse } from '@/tools/langsmith/types'
import { normalizeLangsmithRunPayload } from '@/tools/langsmith/utils'
import type { ToolConfig } from '@/tools/types'

export const langsmithCreateRunTool: ToolConfig<
  LangsmithCreateRunParams,
  LangsmithCreateRunResponse
> = {
  id: 'langsmith_create_run',
  name: 'LangSmith Create Run',
  description: 'Forward a single run to LangSmith for ingestion.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LangSmith API key',
    },
    id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Unique run identifier',
    },
    name: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Run name',
    },
    run_type: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Run type (tool, chain, llm, retriever, embedding, prompt, parser)',
    },
    start_time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run start time in ISO-8601 format',
    },
    end_time: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Run end time in ISO-8601 format',
    },
    inputs: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Inputs payload',
    },
    run_outputs: {
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
    parent_run_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Parent run ID',
    },
    trace_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Trace ID',
    },
    session_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Session ID',
    },
    session_name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Session name',
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
    dotted_order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Dotted order string',
    },
    events: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Structured events array',
    },
  },
  request: {
    url: () => 'https://api.smith.langchain.com/runs',
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const { payload } = normalizeLangsmithRunPayload(params)
      const normalizedPayload: Record<string, unknown> = {
        ...payload,
        name: payload.name?.trim(),
        inputs: params.inputs,
        outputs: params.run_outputs,
        extra: params.extra,
        tags: params.tags,
        status: params.status,
        error: params.error,
        events: params.events,
      }

      return Object.fromEntries(
        Object.entries(normalizedPayload).filter(([, value]) => value !== undefined)
      )
    },
  },
  transformResponse: async (response, params) => {
    const runId = params ? normalizeLangsmithRunPayload(params).runId : null
    const data = (await response.json()) as Record<string, unknown>
    const directMessage =
      typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message
        : null
    const nestedPayload =
      runId && typeof data[runId] === 'object' && data[runId] !== null
        ? (data[runId] as Record<string, unknown>)
        : null
    const nestedMessage =
      nestedPayload && typeof nestedPayload.message === 'string' ? nestedPayload.message : null

    return {
      success: true,
      output: {
        accepted: true,
        runId: runId ?? null,
        message: directMessage ?? nestedMessage ?? null,
      },
    }
  },
  outputs: {
    accepted: {
      type: 'boolean',
      description: 'Whether the run was accepted for ingestion',
    },
    runId: {
      type: 'string',
      description: 'Run identifier provided in the request',
      optional: true,
    },
    message: {
      type: 'string',
      description: 'Response message from LangSmith',
      optional: true,
    },
  },
}
