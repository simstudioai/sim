import { OrchestrationError } from '@/lib/core/orchestration/types'

/** Bounds expanded configuration reports as well as the workflow JSON that produced them. */
export function assertWorkflowPreviewFits(preview: Record<string, unknown>): void {
  for (const [field, value] of Object.entries(preview))
    if (Array.isArray(value) && value.length > 10000)
      throw new OrchestrationError(
        'payload_too_large',
        `Workflow preview ${field} exceeds 10000 entries`
      )
  if (Buffer.byteLength(JSON.stringify(preview), 'utf8') > 10 * 1024 * 1024)
    throw new OrchestrationError('payload_too_large', 'Workflow preview exceeds 10 MiB')
}
