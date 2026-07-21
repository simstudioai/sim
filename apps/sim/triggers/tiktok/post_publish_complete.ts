import { TikTokIcon } from '@/components/icons'
import {
  buildTikTokPostingOutputs,
  buildTikTokTriggerSubBlocks,
  TIKTOK_WEBHOOK_HEADERS,
  tiktokTriggerOptions,
} from '@/triggers/tiktok/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Primary TikTok trigger — includes the trigger-type dropdown.
 * Fires when Content Posting completes (inbox draft published in TikTok).
 */
export const tiktokPostPublishCompleteTrigger: TriggerConfig = {
  id: 'tiktok_post_publish_complete',
  name: 'TikTok Post Publish Complete',
  provider: 'tiktok',
  description: 'Trigger when a TikTok Content Posting publish completes',
  version: '1.0.0',
  icon: TikTokIcon,

  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: tiktokTriggerOptions,
      value: () => 'tiktok_post_publish_complete',
      required: true,
    },
    ...buildTikTokTriggerSubBlocks('tiktok_post_publish_complete', 'post.publish.complete'),
  ],

  outputs: buildTikTokPostingOutputs(),

  webhook: {
    method: 'POST',
    headers: { ...TIKTOK_WEBHOOK_HEADERS },
  },
}
