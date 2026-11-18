import { listWorkflowTriggers } from '@/lib/workflows/application/triggers'
import type { SourceContext } from '@/lib/workspace-source/application/types'

type TriggerKind = Awaited<
  ReturnType<typeof listWorkflowTriggers.execute>
>['triggers'][number]['kind']

/** How a plan names each kind of live trigger: one, then many (the count's key). */
const TRIGGER_NOUNS: Record<TriggerKind, readonly [one: string, many: string]> = {
  schedule: ['schedule', 'schedules'],
  webhook: ['webhook', 'webhooks'],
  polling: ['polling trigger', 'polling triggers'],
  event: ['event trigger', 'event triggers'],
}

const ONE_TRIGGER: ReadonlyMap<string, string> = new Map(
  Object.values(TRIGGER_NOUNS).map(([one, many]) => [many, one])
)

/** The single noun of a count key {@link liveTriggerCounts} wrote in the plural. */
export function oneTrigger(many: string): string {
  return ONE_TRIGGER.get(many) ?? many
}

/**
 * The live triggers the workflow's deployment serves (webhooks, schedules, polling and event
 * triggers), counted by kind under their plural noun: what stops, and which external URLs and
 * timings are lost, when the deployment goes or the workflow is deleted. Empty when it serves none.
 */
export async function liveTriggerCounts(
  ctx: SourceContext,
  workflowId: string
): Promise<Record<string, number>> {
  const { triggers } = await listWorkflowTriggers.execute({
    principal: ctx.principal,
    input: { workflowId },
  })
  const counts: Record<string, number> = {}
  for (const { kind } of triggers) {
    const [, many] = TRIGGER_NOUNS[kind]
    counts[many] = (counts[many] ?? 0) + 1
  }
  return counts
}
