import { OrchestrationError } from '@/lib/core/orchestration/types'
import { resolveStartCandidates } from '@/lib/workflows/triggers/triggers'
import type { BlockState } from '@/stores/workflows/workflow/types'

/** Selects from the deployed graph, retaining the API entry when one is unambiguous. */
export function resolveDeploymentTriggerBlockId(
  blocks: Record<string, BlockState>,
  requestedBlockId?: string
): string {
  const api = resolveStartCandidates(blocks, { execution: 'api' })
  const candidates = [
    ...new Map(
      [
        ...resolveStartCandidates(blocks, { execution: 'manual' }),
        ...resolveStartCandidates(blocks, { execution: 'chat' }),
      ].map((candidate) => [candidate.blockId, candidate])
    ).values(),
  ]
  const available = candidates
    .map(({ blockId, block }) => `${blockId} (${block.name || block.type})`)
    .join(', ')
  if (requestedBlockId) {
    if (candidates.some(({ blockId }) => blockId === requestedBlockId)) return requestedBlockId
    throw new OrchestrationError(
      'validation',
      `run.entry.blockId "${requestedBlockId}" is not an enabled trigger in the active deployment. Available triggers: ${available || 'none'}.`
    )
  }
  const preferred = api.length > 0 ? api : candidates
  if (preferred.length === 1) return preferred[0].blockId
  throw new OrchestrationError(
    'validation',
    preferred.length === 0
      ? 'The active deployment has no enabled runnable trigger. Add a trigger and redeploy before running.'
      : `The active deployment has multiple runnable entry points. Set run.entry to {"type":"trigger","blockId":"<id>"} to choose one. Available triggers: ${available}.`
  )
}
