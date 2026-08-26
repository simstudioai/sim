import type { LangsmithGetRunParams, LangsmithGetRunResponse } from '@/tools/langsmith/types'
import { LANGSMITH_API_BASE, truncateLangsmithErrorText } from '@/tools/langsmith/utils'
import type { ToolConfig } from '@/tools/types'

/**
 * TODO(2026-12-01): migrate to `GET /api/v2/runs/{run_id}` before LangSmith
 * removes the v1 read on 31 Jan 2027 (self-hosted: deprecated in v0.16,
 * removed in v0.18). `GET /api/v1/runs/{run_id}` is `deprecated: true` in the
 * published OpenAPI spec.
 *
 * This is deliberately NOT a URL swap, and doing it early would be the larger
 * break. The v2 read:
 * - requires a `project_id` query param, which this tool does not collect and
 *   the caller of a bare run id usually does not know; and
 * - returns ONLY `id` unless `selects` is passed, so every field below has to
 *   be requested explicitly:
 *   `selects=ID&selects=NAME&selects=RUN_TYPE&selects=STATUS&selects=START_TIME`
 *   `&selects=END_TIME&selects=INPUTS&selects=OUTPUTS&selects=ERROR&selects=TAGS`
 *   `&selects=PROJECT_ID&selects=TRACE_ID&selects=PARENT_RUN_IDS`
 *   `&selects=TOTAL_TOKENS&selects=TOTAL_COST`; and
 * - re-types the declared outputs, so the mapping below must change with it:
 *   `session_id` -> `project_id`; `parent_run_id` (uuid) -> `parent_run_ids`
 *   (array, root-first — take the last entry for the direct parent);
 *   `total_cost` string -> number (this tool's `totalCost` output must become
 *   `type: 'number'`); `status` becomes the enum `SUCCESS | ERROR | PENDING`
 *   rather than lowercase `success`.
 *
 * Migrating now would silently change the values existing workflows already
 * read out of `sessionId`, `parentRunId`, `totalCost`, and `status` ~17 months
 * before anything breaks, so the v1 read stays until the migration is done as
 * a deliberate, versioned change.
 */
export const langsmithGetRunTool: ToolConfig<LangsmithGetRunParams, LangsmithGetRunResponse> = {
  id: 'langsmith_get_run',
  name: 'LangSmith Get Run',
  description:
    'Retrieve a single LangSmith run by ID. Uses the v1 run read, which LangSmith has deprecated and removes on 31 Jan 2027.',
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
      description: 'ID of the run to retrieve',
    },
  },
  request: {
    url: (params) => `${LANGSMITH_API_BASE}/runs/${encodeURIComponent(params.runId.trim())}`,
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },
  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(
        `LangSmith get run failed (${response.status}): ${truncateLangsmithErrorText(errorText)}`
      )
    }

    const data = (await response.json()) as Record<string, unknown>

    return {
      success: true,
      output: {
        id: data.id as string,
        runId: data.id as string,
        name: data.name as string,
        runType: data.run_type as string,
        status: (data.status as string) ?? null,
        startTime: (data.start_time as string) ?? null,
        endTime: (data.end_time as string) ?? null,
        inputs: (data.inputs as Record<string, unknown>) ?? null,
        outputs: (data.outputs as Record<string, unknown>) ?? null,
        error: (data.error as string) ?? null,
        tags: (data.tags as string[]) ?? [],
        sessionId: (data.session_id as string) ?? null,
        traceId: (data.trace_id as string) ?? null,
        parentRunId: (data.parent_run_id as string) ?? null,
        totalTokens: (data.total_tokens as number) ?? null,
        totalCost: (data.total_cost as string) ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Run ID' },
    runId: {
      type: 'string',
      description: 'Run ID (alias of id, for consistency with other operations)',
    },
    name: { type: 'string', description: 'Run name' },
    runType: {
      type: 'string',
      description: 'Run type (tool, chain, llm, retriever, embedding, prompt, parser)',
    },
    status: { type: 'string', description: 'Run status', optional: true },
    startTime: { type: 'string', description: 'Run start time (ISO)', optional: true },
    endTime: { type: 'string', description: 'Run end time (ISO)', optional: true },
    inputs: { type: 'json', description: 'Run inputs payload', optional: true },
    outputs: { type: 'json', description: 'Run outputs payload', optional: true },
    error: { type: 'string', description: 'Error details, if the run failed', optional: true },
    tags: { type: 'array', description: 'Tags attached to the run', items: { type: 'string' } },
    sessionId: {
      type: 'string',
      description: 'Project (session) ID the run belongs to',
      optional: true,
    },
    traceId: { type: 'string', description: 'Trace ID', optional: true },
    parentRunId: { type: 'string', description: 'Parent run ID', optional: true },
    totalTokens: {
      type: 'number',
      description: 'Total tokens consumed by the run',
      optional: true,
    },
    totalCost: { type: 'string', description: 'Total cost of the run', optional: true },
  },
}
