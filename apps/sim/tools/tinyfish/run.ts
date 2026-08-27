import { tinyfishAgentHosting } from '@/tools/tinyfish/hosting'
import {
  RUN_ERROR_OUTPUT_PROPERTIES,
  SCHEMA_VALIDATION_OUTPUT_PROPERTIES,
  type TinyFishRawRun,
  type TinyFishRunParams,
  type TinyFishRunResponse,
} from '@/tools/tinyfish/types'
import {
  AUTOMATION_TOOL_PARAMS,
  buildAutomationBody,
  mapRunError,
  mapSchemaValidation,
  selectAutomationModelInput,
  TINYFISH_AGENT_API_BASE,
  tinyfishErrorMessage,
  tinyfishHeaders,
} from '@/tools/tinyfish/utils'
import type { ToolConfig } from '@/tools/types'

export const runTool: ToolConfig<TinyFishRunParams, TinyFishRunResponse> = {
  id: 'tinyfish_run',
  name: 'TinyFish Run Agent',
  description:
    'Run a TinyFish web agent against a website and wait for it to finish, returning the structured result it extracted',
  version: '1.0.0',

  params: { ...AUTOMATION_TOOL_PARAMS },

  hosting: tinyfishAgentHosting(),

  request: {
    url: `${TINYFISH_AGENT_API_BASE}/v1/automation/run`,
    method: 'POST',
    headers: (params) => tinyfishHeaders(params.apiKey),
    body: (params) => buildAutomationBody(params),
    modelInput: {
      mode: 'project',
      select: selectAutomationModelInput,
    },
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await tinyfishErrorMessage(response))
    }

    const data = (await response.json()) as TinyFishRawRun

    return {
      /**
       * A failed run is reported inside a 200 response, so success comes from
       * the run's own status rather than the HTTP status.
       */
      success: data.status === 'COMPLETED',
      output: {
        runId: data.run_id ?? null,
        status: data.status ?? 'FAILED',
        startedAt: data.started_at ?? null,
        finishedAt: data.finished_at ?? null,
        numOfSteps: data.num_of_steps ?? null,
        result: data.result ?? null,
        schemaValidation: mapSchemaValidation(data.schema_validation),
        error: mapRunError(data.error),
      },
      error: data.error?.message ?? undefined,
    }
  },

  outputs: {
    runId: { type: 'string', description: 'Run identifier', optional: true },
    status: { type: 'string', description: 'Final run status: COMPLETED or FAILED' },
    startedAt: {
      type: 'string',
      description: 'ISO 8601 timestamp when the run started',
      optional: true,
    },
    finishedAt: {
      type: 'string',
      description: 'ISO 8601 timestamp when the run finished',
      optional: true,
    },
    numOfSteps: { type: 'number', description: 'Steps the agent took', optional: true },
    result: {
      type: 'json',
      description: 'Structured data the agent extracted, null when the run failed',
      optional: true,
    },
    schemaValidation: {
      type: 'object',
      description: 'Validation of the result against the requested output schema',
      optional: true,
      properties: SCHEMA_VALIDATION_OUTPUT_PROPERTIES,
    },
    error: {
      type: 'object',
      description:
        'Why the run failed, null when it succeeded. Branch on category to decide whether to retry',
      optional: true,
      properties: RUN_ERROR_OUTPUT_PROPERTIES,
    },
  },
}
