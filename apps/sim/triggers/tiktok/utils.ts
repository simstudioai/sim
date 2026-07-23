import { getScopesForService } from '@/lib/oauth/utils'
import type { SubBlockConfig } from '@/blocks/types'
import type { TriggerOutput } from '@/triggers/types'

export const tiktokTriggerOptions = [
  { label: 'Post Publish Complete', id: 'tiktok_post_publish_complete' },
  { label: 'Post Publish Failed', id: 'tiktok_post_publish_failed' },
  { label: 'Post Inbox Delivered', id: 'tiktok_post_inbox_delivered' },
  { label: 'Post Publicly Available', id: 'tiktok_post_publicly_available' },
  { label: 'Post No Longer Public', id: 'tiktok_post_no_longer_public' },
  { label: 'Authorization Removed', id: 'tiktok_authorization_removed' },
]

/** Map Sim trigger ids to TikTok `event` strings (documented spelling preserved). */
export const TIKTOK_TRIGGER_EVENT_MAP: Record<string, string> = {
  tiktok_post_publish_complete: 'post.publish.complete',
  tiktok_post_publish_failed: 'post.publish.failed',
  tiktok_post_inbox_delivered: 'post.publish.inbox_delivered',
  tiktok_post_publicly_available: 'post.publish.publicly_available',
  tiktok_post_no_longer_public: 'post.publish.no_longer_publicaly_available',
  tiktok_authorization_removed: 'authorization.removed',
}

export function isTikTokEventMatch(triggerId: string, event: string | undefined): boolean {
  if (!event) return false
  const expected = TIKTOK_TRIGGER_EVENT_MAP[triggerId]
  return expected === event
}

export function tiktokSetupInstructions(eventLabel: string): string {
  const instructions = [
    '<strong>App setup:</strong> A Sim operator must register the full app-level Callback URL <code>https://&lt;your-sim-domain&gt;/api/webhooks/tiktok</code> once in the TikTok Developer Portal. TikTok allows one Callback URL per app, so workflow builders do not paste a unique webhook URL.',
    'Connect the <strong>TikTok account</strong> that should receive this event using the credential selector above.',
    `This trigger listens for <strong>${eventLabel}</strong> events for that connected account.`,
    '<strong>Deploy</strong> the workflow to activate the trigger.',
  ]

  return instructions
    .map(
      (instruction, index) =>
        `<div class="mb-3">${index === 0 ? instruction : `<strong>${index}.</strong> ${instruction}`}</div>`
    )
    .join('')
}

/**
 * Builds subBlocks for a TikTok trigger: OAuth credential + setup instructions.
 * Omits the per-workflow Webhook URL field — TikTok uses a fixed app-level Callback URL.
 */
export function buildTikTokTriggerSubBlocks(
  triggerId: string,
  eventLabel: string
): SubBlockConfig[] {
  return [
    {
      id: 'triggerCredentials',
      title: 'TikTok Account',
      type: 'oauth-input',
      serviceId: 'tiktok',
      requiredScopes: getScopesForService('tiktok'),
      mode: 'trigger',
      required: true,
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
    {
      id: 'triggerInstructions',
      title: 'Setup Instructions',
      hideFromPreview: true,
      type: 'text',
      defaultValue: tiktokSetupInstructions(eventLabel),
      mode: 'trigger',
      condition: { field: 'selectedTriggerId', value: triggerId },
    },
  ]
}

function buildCommonOutputs(): Record<string, TriggerOutput> {
  return {
    event: { type: 'string', description: 'TikTok webhook event name' },
    createTime: {
      type: 'number',
      description: 'UTC epoch seconds when the event occurred',
    },
    userOpenId: {
      type: 'string',
      description: 'TikTok user open_id for the connected account',
    },
    clientKey: {
      type: 'string',
      description: 'TikTok app client_key that received the event',
    },
  }
}

export function buildTikTokPostingOutputs(options?: {
  includeFailReason?: boolean
  includePostId?: boolean
}): Record<string, TriggerOutput> {
  const outputs: Record<string, TriggerOutput> = {
    ...buildCommonOutputs(),
    publishId: { type: 'string', description: 'Content Posting API publish_id' },
    publishType: {
      type: 'string',
      description: 'Publish type (e.g. DIRECT_POST, INBOX_SHARE)',
    },
  }
  if (options?.includePostId) {
    outputs.postId = {
      type: 'string',
      description: 'TikTok post_id when the post is publicly available',
    }
  }
  if (options?.includeFailReason) {
    outputs.failReason = {
      type: 'string',
      description: 'Failure reason enum from TikTok when publishing fails',
    }
  }
  return outputs
}

export function buildTikTokAuthorizationRemovedOutputs(): Record<string, TriggerOutput> {
  return {
    ...buildCommonOutputs(),
    reason: {
      type: 'number',
      description:
        'Revocation reason (0 unknown, 1 user disconnect, 2 account deleted, 3 age change, 4 banned, 5 developer revoke)',
    },
  }
}

export const TIKTOK_WEBHOOK_HEADERS = {
  'Content-Type': 'application/json',
  'TikTok-Signature': 't=<timestamp>,s=<hmac-sha256-hex>',
} as const
