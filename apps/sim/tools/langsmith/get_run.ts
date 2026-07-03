import type { LangsmithGetRunParams, LangsmithGetRunResponse } from '@/tools/langsmith/types'
import type { ToolConfig } from '@/tools/types'

export const langsmithGetRunTool: ToolConfig<LangsmithGetRunParams, LangsmithGetRunResponse> = {
  id: 'langsmith_get_run',
  name: 'LangSmith Get Run',
  description: 'Retrieve a single LangSmith run by ID.',
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
    url: (params) => `https://api.smith.langchain.com/runs/${params.runId.trim()}`,
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
    }),
  },
  transformResponse: async (response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`LangSmith get run failed (${response.status}): ${errorText}`)
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
