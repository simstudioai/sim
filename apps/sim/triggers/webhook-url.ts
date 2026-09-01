import { getBaseUrl } from '@/lib/core/utils/urls'
import {
  buildSubBlockValues,
  evaluateSubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import { getBlock } from '@/blocks/registry'
import type { BlockState } from '@/stores/workflows/workflow/types'
import { getTrigger, isTriggerValid } from '@/triggers'

/** The public URL an external system POSTs to for a given webhook path. */
export function buildWebhookTriggerUrl(path: string): string {
  return `${getBaseUrl()}/api/webhooks/trigger/${path}`
}

/**
 * The Request URL a Slack custom-bot app posts events to. One URL per
 * credential (not per workflow): the endpoint verifies with the credential's
 * signing secret and fans out to every workflow whose trigger routes by this
 * credential id. Uses the app's public base so Slack's servers can reach it.
 */
export function buildSlackCustomBotRequestUrl(credentialId: string): string {
  return `${getBaseUrl()}/api/webhooks/slack/custom/${credentialId}`
}

function subBlockValue(block: BlockState, subBlockId: string): unknown {
  return block.subBlocks?.[subBlockId]?.value
}

/**
 * The trigger a block deploys as, or undefined when it is not acting as one.
 *
 * A dedicated trigger block IS its trigger; a tool block flipped into trigger mode names one via
 * `selectedTriggerId` / `triggerId`, falling back to the first trigger its config declares
 * available. Single-sourced here because the webhook deploy path and anything reasoning about a
 * block's delivery must agree on the answer - two resolutions would let a block deploy as one
 * trigger while another layer classified it as a different one.
 */
export function resolveBlockTriggerId(block: BlockState): string | undefined {
  const blockConfig = getBlock(block.type)

  if (blockConfig?.category === 'triggers' && isTriggerValid(block.type)) {
    return block.type
  }

  if (!block.triggerMode) {
    return undefined
  }

  const selectedTriggerId = subBlockValue(block, 'selectedTriggerId')
  if (typeof selectedTriggerId === 'string' && isTriggerValid(selectedTriggerId)) {
    return selectedTriggerId
  }

  const storedTriggerId = subBlockValue(block, 'triggerId')
  if (typeof storedTriggerId === 'string' && isTriggerValid(storedTriggerId)) {
    return storedTriggerId
  }

  if (blockConfig?.triggers?.enabled) {
    const configuredTriggerId =
      typeof selectedTriggerId === 'string' ? selectedTriggerId : undefined
    if (configuredTriggerId && isTriggerValid(configuredTriggerId)) {
      return configuredTriggerId
    }

    const available = blockConfig.triggers?.available?.[0]
    if (available && isTriggerValid(available)) {
      return available
    }
  }

  return undefined
}

/**
 * The webhook provider a block's events arrive under, or null when it is not a trigger.
 *
 * This is the identity an inbound request is verified against: a path served by a `slack` webhook
 * authenticates Slack's signature and parses Slack's event shape. Two triggers of DIFFERENT
 * providers can therefore never share a URL meaningfully, however similar they look.
 */
export function resolveBlockTriggerProvider(block: BlockState): string | null {
  const triggerId = resolveBlockTriggerId(block)
  if (!triggerId || !isTriggerValid(triggerId)) return null
  return getTrigger(triggerId).provider ?? null
}

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
