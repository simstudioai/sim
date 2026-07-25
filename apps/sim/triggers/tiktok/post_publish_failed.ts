import { TikTokIcon } from '@/components/icons'
import {
  buildTikTokPostingOutputs,
  buildTikTokTriggerSubBlocks,
  TIKTOK_WEBHOOK_HEADERS,
} from '@/triggers/tiktok/utils'
import type { TriggerConfig } from '@/triggers/types'

export const tiktokPostPublishFailedTrigger: TriggerConfig = {
  id: 'tiktok_post_publish_failed',
  name: 'TikTok Post Publish Failed',
  provider: 'tiktok',
  description: 'Trigger when a TikTok Content Posting publish fails',
  version: '1.0.0',
  icon: TikTokIcon,

  subBlocks: buildTikTokTriggerSubBlocks('tiktok_post_publish_failed', 'post.publish.failed'),

  outputs: buildTikTokPostingOutputs({ includeFailReason: true }),

  webhook: {
    method: 'POST',
    headers: { ...TIKTOK_WEBHOOK_HEADERS },
  },
}
