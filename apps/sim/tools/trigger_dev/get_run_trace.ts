import type { TriggerDevRunIdParams, TriggerDevRunTraceResponse } from '@/tools/trigger_dev/types'
import { buildTriggerDevHeaders, TRIGGER_DEV_API_BASE } from '@/tools/trigger_dev/utils'
import type { ToolConfig } from '@/tools/types'

export const triggerDevGetRunTraceTool: ToolConfig<
  TriggerDevRunIdParams,
  TriggerDevRunTraceResponse
> = {
  id: 'trigger_dev_get_run_trace',
  name: 'Trigger.dev Get Run Trace',
  description:
    'Retrieve the OpenTelemetry trace of a Trigger.dev run as a tree of spans with timing, errors, and nested children.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Trigger.dev secret API key (starts with tr_)',
    },
    runId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the run to retrieve the trace for (starts with run_)',
    },
  },

  request: {
    url: (params) =>
      `${TRIGGER_DEV_API_BASE}/api/v1/runs/${encodeURIComponent(params.runId.trim())}/trace`,
    method: 'GET',
    headers: (params) => buildTriggerDevHeaders(params.apiKey),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        traceId: data.trace?.traceId ?? null,
        rootSpan: data.trace?.rootSpan ?? null,
      },
    }
  },

  outputs: {
    traceId: { type: 'string', description: 'OpenTelemetry trace ID of the run' },
    rootSpan: {
      type: 'json',
      description:
        'Root span of the trace; each span has id, parentId, runId, data (message, taskSlug, startTime, duration, isError, level, events), and recursively nested children spans',
    },
  },
}
