import type {
  DynatraceExecuteSyntheticMonitorsParams,
  DynatraceExecuteSyntheticMonitorsResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  parseJsonParam,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const executeSyntheticMonitorsTool: ToolConfig<
  DynatraceExecuteSyntheticMonitorsParams,
  DynatraceExecuteSyntheticMonitorsResponse
> = {
  id: 'dynatrace_execute_synthetic_monitors',
  name: 'Dynatrace Execute Synthetic Monitors',
  description:
    'Trigger an on-demand batch execution of synthetic monitors, for gating a deploy on a smoke test. Returns a batch ID to poll.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.DYNATRACE_ERRORS,

  params: {
    environmentUrl: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace environment URL (e.g., https://abc12345.live.dynatrace.com, or https://your-activegate:9999/e/abc12345 for Managed)',
    },
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description:
        'Dynatrace access token (dt0c01...) with syntheticExecutions.write or ExternalSyntheticIntegration',
    },
    monitors: {
      type: 'json',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Monitors to run, as an array of objects with monitorId and optional locations and executionCount (e.g. [{"monitorId":"SYNTHETIC_TEST-123","executionCount":1}]). Execution count caps at 10',
    },
    processingMode: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'STANDARD, DISABLE_PROBLEM_DETECTION, or EXECUTIONS_DETAILS_ONLY',
    },
    failOnPerformanceIssue: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Treat a performance threshold breach as a failure',
    },
    stopOnProblem: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Stop the batch as soon as one monitor reports a problem',
    },
    takeScreenshotsOnSuccess: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Capture screenshots for successful browser executions too',
    },
    metadata: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Key-value metadata to attach to the batch, e.g. the release version. Max 64 pairs, 1024 characters each',
    },
  },

  request: {
    url: (params) => buildDynatraceUrl(params.environmentUrl, '/synthetic/executions/batch'),
    method: 'POST',
    headers: (params) => dynatraceHeaders(params.apiToken),
    body: (params) => {
      const monitors = parseJsonParam(params.monitors)
      if (!Array.isArray(monitors) || monitors.length === 0) {
        throw new Error('monitors must be a non-empty array of objects with a monitorId')
      }
      const body: Record<string, unknown> = { monitors }
      if (params.processingMode) body.processingMode = params.processingMode
      if (params.failOnPerformanceIssue !== undefined) {
        body.failOnPerformanceIssue = params.failOnPerformanceIssue
      }
      if (params.stopOnProblem !== undefined) body.stopOnProblem = params.stopOnProblem
      if (params.takeScreenshotsOnSuccess !== undefined) {
        body.takeScreenshotsOnSuccess = params.takeScreenshotsOnSuccess
      }
      const metadata = parseJsonParam(params.metadata)
      if (metadata) body.metadata = metadata
      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)

    return {
      success: true,
      output: {
        batchId: (data.batchId as string) ?? null,
        triggeredCount: (data.triggeredCount as number) ?? null,
        triggeringProblemsCount: (data.triggeringProblemsCount as number) ?? null,
        triggered: Array.isArray(data.triggered)
          ? (data.triggered as Array<Record<string, unknown>>)
          : [],
        triggeringProblemsDetails: Array.isArray(data.triggeringProblemsDetails)
          ? (data.triggeringProblemsDetails as Array<Record<string, unknown>>)
          : [],
      },
    }
  },

  outputs: {
    batchId: {
      type: 'string',
      description: 'ID of the batch, to poll with Get Synthetic Batch',
      nullable: true,
    },
    triggeredCount: {
      type: 'number',
      description: 'How many executions were triggered',
      nullable: true,
    },
    triggeringProblemsCount: {
      type: 'number',
      description: 'How many executions could not be triggered',
      nullable: true,
    },
    triggered: {
      type: 'array',
      description: 'Triggered executions, grouped by monitor',
      items: {
        type: 'object',
        properties: {
          monitorId: { type: 'string', description: 'Monitor that was triggered' },
          executions: {
            type: 'array',
            description: 'One entry per location the monitor ran from',
            items: {
              type: 'object',
              properties: {
                executionId: { type: 'string', description: 'Execution ID' },
                locationId: { type: 'string', description: 'Location the execution ran from' },
              },
            },
          },
        },
      },
    },
    triggeringProblemsDetails: {
      type: 'array',
      description: 'Why each untriggered execution failed to start',
      items: {
        type: 'object',
        properties: {
          cause: { type: 'string', description: 'Why the execution could not be triggered' },
          details: { type: 'string', description: 'Detail behind the cause' },
          entityId: { type: 'string', description: 'Entity the problem relates to' },
          executionId: { type: 'string', description: 'Execution ID, when one was assigned' },
          locationId: { type: 'string', description: 'Location the execution targeted' },
        },
      },
    },
  },
}
