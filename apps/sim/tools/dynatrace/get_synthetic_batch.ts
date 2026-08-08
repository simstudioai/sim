import type {
  DynatraceGetSyntheticBatchParams,
  DynatraceGetSyntheticBatchResponse,
} from '@/tools/dynatrace/types'
import {
  buildDynatraceUrl,
  dynatraceHeaders,
  encodeDynatraceId,
  readJsonBody,
} from '@/tools/dynatrace/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const getSyntheticBatchTool: ToolConfig<
  DynatraceGetSyntheticBatchParams,
  DynatraceGetSyntheticBatchResponse
> = {
  id: 'dynatrace_get_synthetic_batch',
  name: 'Dynatrace Get Synthetic Batch',
  description:
    'Get the status and failures of an on-demand synthetic batch execution. Poll it after triggering to gate a deploy on the result.',
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
        'Dynatrace access token (dt0c01...) with syntheticExecutions.read, ReadSyntheticData, or ExternalSyntheticIntegration',
    },
    batchId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Batch ID returned by Execute Synthetic Monitors',
    },
  },

  request: {
    url: (params) =>
      buildDynatraceUrl(
        params.environmentUrl,
        `/synthetic/executions/batch/${encodeDynatraceId(params.batchId)}`
      ),
    method: 'GET',
    headers: (params) => dynatraceHeaders(params.apiToken),
  },

  transformResponse: async (response: Response) => {
    const data = await readJsonBody(response)
    const list = (key: string) =>
      Array.isArray(data[key]) ? (data[key] as Array<Record<string, unknown>>) : []

    return {
      success: true,
      output: {
        batchId: (data.batchId as string) ?? null,
        batchStatus: (data.batchStatus as string) ?? null,
        executedCount: (data.executedCount as number) ?? null,
        failedCount: (data.failedCount as number) ?? null,
        failedToExecuteCount: (data.failedToExecuteCount as number) ?? null,
        triggeredCount: (data.triggeredCount as number) ?? null,
        triggeringProblemsCount: (data.triggeringProblemsCount as number) ?? null,
        failedExecutions: list('failedExecutions'),
        failedToExecute: list('failedToExecute'),
        triggeringProblems: list('triggeringProblems'),
        metadata:
          data.metadata && typeof data.metadata === 'object'
            ? (data.metadata as Record<string, unknown>)
            : {},
        userId: (data.userId as string) ?? null,
      },
    }
  },

  outputs: {
    batchId: { type: 'string', description: 'ID of the batch', nullable: true },
    batchStatus: {
      type: 'string',
      description: 'RUNNING, SUCCESS, FAILED, FAILED_TO_EXECUTE, or NOT_TRIGGERED',
      nullable: true,
    },
    executedCount: { type: 'number', description: 'Executions completed', nullable: true },
    failedCount: { type: 'number', description: 'Executions that failed', nullable: true },
    failedToExecuteCount: {
      type: 'number',
      description: 'Executions that never ran',
      nullable: true,
    },
    triggeredCount: { type: 'number', description: 'Executions triggered', nullable: true },
    triggeringProblemsCount: {
      type: 'number',
      description: 'Executions that could not be triggered',
      nullable: true,
    },
    failedExecutions: { type: 'json', description: 'Failed executions with their error codes' },
    failedToExecute: { type: 'json', description: 'Executions that never started' },
    triggeringProblems: { type: 'json', description: 'Reasons executions could not be triggered' },
    metadata: { type: 'json', description: 'Metadata attached when the batch was triggered' },
    userId: { type: 'string', description: 'Who triggered the batch', nullable: true },
  },
}
