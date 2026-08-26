import { filterUndefined } from '@sim/utils/object'
import type {
  LangsmithCreateRunsBatchParams,
  LangsmithCreateRunsBatchResponse,
  LangsmithRunPayload,
} from '@/tools/langsmith/types'
import {
  LANGSMITH_API_BASE,
  normalizeLangsmithRunPayload,
  prepareLangsmithPatchPayload,
  truncateLangsmithErrorText,
} from '@/tools/langsmith/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * Narrows `post`/`patch` to the array the batch body requires.
 *
 * Both are declared `type: 'json'`, which `buildParameterSchema` collapses to `{"type":"object"}`
 * in the model-facing schema — so an LLM that follows that schema faithfully sends an object, and
 * the `.map()` below would throw a bare `params.post.map is not a function`. Fail with a message
 * that names the field and the expected shape instead.
 *
 * `tags` and `events` carry the same `type: 'json'` ambiguity but are never iterated here: they
 * are forwarded verbatim inside each run payload and validated by LangSmith, which answers a
 * wrong shape with a 422 the tool already surfaces. Nothing local to guard.
 */
const asRunArray = (
  value: LangsmithRunPayload[] | undefined,
  field: 'post' | 'patch'
): LangsmithRunPayload[] | undefined => {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) {
    throw new Error(
      `LangSmith batch \`${field}\` must be an array of run objects, received ${typeof value}. Wrap a single run as \`[{ ... }]\`.`
    )
  }
  return value
}

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
    url: () => `${LANGSMITH_API_BASE}/runs/batch`,
    method: 'POST',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const post = asRunArray(params.post, 'post')
      const patch = asRunArray(params.patch, 'patch')
      const payload: Record<string, unknown> = {
        post: post ? post.map((run) => normalizeLangsmithRunPayload(run).payload) : undefined,
        patch: patch ? patch.map((run) => prepareLangsmithPatchPayload(run).payload) : undefined,
      }

      return filterUndefined(payload)
    },
  },
  transformResponse: async (response, params) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `LangSmith create runs batch failed (${response.status}): ${truncateLangsmithErrorText(errorText)}`
      )
    }

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

    const collectRunIds = (
      runs: LangsmithRunPayload[] | undefined,
      resolve: (run: LangsmithRunPayload) => string
    ) => runs?.map(resolve) ?? []

    return {
      success: true,
      output: {
        accepted: true,
        runIds: [
          ...collectRunIds(asRunArray(params?.post, 'post'), (run) =>
            normalizeLangsmithRunPayload(run).runId
          ),
          ...collectRunIds(asRunArray(params?.patch, 'patch'), (run) =>
            prepareLangsmithPatchPayload(run).runId
          ),
        ],
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
