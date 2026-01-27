import type {
  LangsmithCreateRunsBatchParams,
  LangsmithCreateRunsBatchResponse,
  LangsmithRunPayload,
} from '@/tools/langsmith/types'
import { normalizeLangsmithRunPayload } from '@/tools/langsmith/utils'
import type { ToolConfig } from '@/tools/types'

export const langsmithCreateRunsBatchTool: ToolConfig<
  LangsmithCreateRunsBatchParams,
  LangsmithCreateRunsBatchResponse
> = {
  id: 'langsmith_create_runs_batch',
  name: 'LangSmith Create Runs Batch',
  description: 'Forward multiple runs to LangSmith in a single batch.',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'LangSmith API key',
    },
    post: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of new runs to ingest',
    },
    patch: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Array of runs to update/patch',
    },
  },
  request: {
    url: () => 'https://api.smith.langchain.com/runs/batch',
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const payload: Record<string, unknown> = {
        post: params.post
          ? params.post.map((run) => normalizeLangsmithRunPayload(run).payload)
          : undefined,
        patch: params.patch
          ? params.patch.map((run) => normalizeLangsmithRunPayload(run).payload)
          : undefined,
      }

      return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
    },
  },
  transformResponse: async (response, params) => {
    const data = (await response.json()) as Record<string, unknown>
    const directMessage =
      typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message
        : null
    const messages = Object.values(data)
      .map((value) => {
        if (typeof value !== 'object' || value === null) {
          return null
        }
        const messageValue = (value as Record<string, unknown>).message
        return typeof messageValue === 'string' ? messageValue : null
      })
      .filter((value): value is string => Boolean(value))

    const collectRunIds = (runs?: LangsmithRunPayload[]) =>
      runs?.map((run) => normalizeLangsmithRunPayload(run).runId) ?? []

    return {
      success: true,
      output: {
        accepted: true,
        runIds: [...collectRunIds(params?.post), ...collectRunIds(params?.patch)],
        message: directMessage ?? null,
        messages: messages.length ? messages : undefined,
      },
    }
  },
  outputs: {
    accepted: {
      type: 'boolean',
      description: 'Whether the batch was accepted for ingestion',
    },
    runIds: {
      type: 'array',
      description: 'Run identifiers provided in the request',
      items: {
        type: 'string',
      },
    },
    message: {
      type: 'string',
      description: 'Response message from LangSmith',
      optional: true,
    },
    messages: {
      type: 'array',
      description: 'Per-run response messages, when provided',
      optional: true,
      items: {
        type: 'string',
      },
    },
  },
}
