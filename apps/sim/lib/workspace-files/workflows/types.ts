import { z } from 'zod'

export const FILE_WORKFLOW_INTERVAL_MS = 300_000
export const FILE_WORKFLOW_RESULT_MAX_BYTES = 1024 * 1024
export const FILE_WORKFLOW_RESULT_TTL_SECONDS = 300
export const fileWorkflowIdsSchema = z
  .array(z.string().min(1).max(128))
  .max(10, 'A file can call at most 10 workflows')
  .refine((ids) => new Set(ids).size === ids.length, 'workflowIds must be unique')
  .describe('Deployed workflows this HTML file may call, in the same workspace.')
export const fileWorkflowSnapshotSchema = z.object({
  status: z
    .enum(['empty', 'running', 'completed', 'failed'])
    .describe(
      'Result availability for this caller. Empty includes an expired or evicted cache entry.'
    ),
  executionId: z
    .string()
    .nullable()
    .describe('Run identifier, visible only to the audience that started it.'),
  deploymentVersionId: z
    .string()
    .nullable()
    .describe('Deployment selected when this execution started, when available.'),
  generatedAt: z.iso
    .datetime()
    .nullable()
    .describe('Time the result was generated, or null when unavailable.'),
  nextRunAt: z.iso
    .datetime()
    .nullable()
    .describe('Earliest next attempt. A still-running execution also prevents a new attempt.'),
  /** Arbitrary workflow JSON, bounded before caching. */
  output: z
    .unknown()
    .describe(
      'Arbitrary workflow JSON output, limited to 1 MB; null when no completed output is available.'
    ),
  error: z.string().nullable().describe('Safe execution error message, or null.'),
})
export type FileWorkflowSnapshot = z.output<typeof fileWorkflowSnapshotSchema>

export function isWorkflowHtml(contentType: string): boolean {
  return ['text/html', 'text/x-sim-page'].includes(
    contentType.split(';', 1)[0].trim().toLowerCase()
  )
}
