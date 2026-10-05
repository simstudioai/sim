import { toStringOrNull } from '@sim/utils/coerce'
import { toArray, toRecordOrNull } from '@sim/utils/object'
import type { ToolConfig } from '@/tools/types'
import type { YouComResearchParams, YouComResearchResponse } from '@/tools/youcom/types'
import {
  buildDomainFilters,
  mapResearchSources,
  parseJsonSchema,
  RESEARCH_ANSWER_OUTPUTS,
  toCode,
  YOUCOM_API_BASE_URL,
  youComApiKeyParam,
  youComHeaders,
} from '@/tools/youcom/utils'

export const youComResearchTool: ToolConfig<YouComResearchParams, YouComResearchResponse> = {
  id: 'youcom_research',
  name: 'You.com Research',
  description:
    'Run multi-step web research on a question and get a thorough, cited answer, or start it as a background task.',
  version: '1.0.0',

  params: {
    input: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Research question or complex query (up to 40,000 characters)',
    },
    researchEffort: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Depth of research: lite (<10s), standard (10-30s), deep (<120s), exhaustive (<300s), or frontier (always runs in the background and returns a task ID). Defaults to standard',
    },
    outputSchema: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'JSON Schema for structured output in content. Every object needs additionalProperties: false and all properties required. Not supported with lite',
    },
    background: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description:
        'Run as a background task and return a task ID to poll with Get Research Task. Always on for frontier',
    },
    includeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated domains the research may use (up to 500). Cannot be combined with exclude or boost domains',
    },
    excludeDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated domains the research must not search or visit (up to 500)',
    },
    boostDomains: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated domains to rank higher without filtering others (up to 500)',
    },
    freshness: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Source recency: day, week, month, year, or a range like 2025-01-01to2025-12-31',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code that focuses web results (e.g., US, GB, DE)',
    },
    apiKey: youComApiKeyParam,
  },

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({ input: params.input, outputSchema: params.outputSchema }),
    },
    url: `${YOUCOM_API_BASE_URL}/research`,
    method: 'POST',
    headers: youComHeaders,
    body: (params) => {
      const body: Record<string, unknown> = { input: params.input }
      if (params.researchEffort) body.research_effort = params.researchEffort
      const background = params.background === true || String(params.background) === 'true'
      if (background || params.researchEffort === 'frontier') body.background = true

      const outputSchema = parseJsonSchema(params.outputSchema)
      if (outputSchema) body.output_schema = outputSchema

      const sourceControl: Record<string, unknown> = buildDomainFilters(params)
      if (params.freshness) sourceControl.freshness = params.freshness.trim()
      const country = toCode(params.country)
      if (country) sourceControl.country = country
      if (Object.keys(sourceControl).length > 0) body.source_control = sourceControl

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const output = toRecordOrNull(data.output)

    return {
      success: true,
      output: {
        content: (output?.content as string | Record<string, unknown> | undefined) ?? null,
        contentType: toStringOrNull(output?.content_type),
        sources: mapResearchSources(output?.sources),
        warnings: toArray(data.warnings).map(String),
        taskId: toStringOrNull(data.task_id),
        status: toStringOrNull(data.status),
        streamUrl: toStringOrNull(data.stream_url),
        createdAt: toStringOrNull(data.created_at),
      },
    }
  },

  outputs: {
    ...RESEARCH_ANSWER_OUTPUTS,
    taskId: {
      type: 'string',
      description: 'Background task ID to pass to Get Research Task (background only)',
      nullable: true,
    },
    status: {
      type: 'string',
      description:
        'Background task status: queued, running, completed, failed, or cancelled (background only)',
      nullable: true,
    },
    streamUrl: {
      type: 'string',
      description: 'URL path of the task progress event stream (background only)',
      nullable: true,
    },
    createdAt: {
      type: 'string',
      description: 'When the background task was created, RFC 3339 (background only)',
      nullable: true,
    },
  },
}
