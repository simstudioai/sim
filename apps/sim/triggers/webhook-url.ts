import {
  buildSubBlockValues,
  evaluateSubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'

/**
 * Whether this block advertises a public webhook URL - one an external system POSTs to at
 * `/api/webhooks/trigger/<path>`.
 *
 * The marker is the `useWebhookUrl` sub-block: the field that renders the copyable URL in the
 * block's own config. If the UI shows a URL for a block, that is a URL someone could have pasted
 * into Slack or a provider console; if it does not, there is nothing external pointing at it.
 * That makes this the right question for anything reasoning about "would changing this break a
 * caller" - which is why the copilot's read view and the fork sync both ask it here rather than
 * re-deriving it.
 *
 * Deliberately NOT derived from the trigger definition. Neither declarative flag separates the
 * families cleanly: `polling` is set on 8 of the trigger defs while several pollers omit it, and
 * `webhook` is set on ~345 including `slack_oauth`, which routes by `routingKey` on a shared
 * endpoint and has no per-workflow URL at all.
 *
 * Condition-aware on purpose: a multi-trigger block namespaces one URL field per trigger id, each
 * gated on `selectedTriggerId`, so a block currently configured with a POLLING trigger correctly
 * reports false even though its config declares a URL field for a sibling trigger.
 */
export function blockAdvertisesWebhookUrl(block: BlockState): boolean {
  const blockConfig = getBlock(block.type)
  if (!blockConfig) return false

  const actsAsTrigger = blockConfig.category === 'triggers' || block.triggerMode === true
  if (!actsAsTrigger) return false

  const values = buildSubBlockValues(block.subBlocks || {})
  return blockConfig.subBlocks.some(
    (subBlock) =>
      subBlock.useWebhookUrl === true && evaluateSubBlockCondition(subBlock.condition, values)
  )
}
