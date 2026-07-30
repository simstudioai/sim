import { TikTokIcon } from '@/components/icons'
import {
  buildTikTokPostingOutputs,
  buildTikTokTriggerSubBlocks,
  TIKTOK_WEBHOOK_HEADERS,
} from '@/triggers/tiktok/utils'
import type { TriggerConfig } from '@/triggers/types'

export const tiktokPostPubliclyAvailableTrigger: TriggerConfig = {
  id: 'tiktok_post_publicly_available',
  name: 'TikTok Post Publicly Available',
  provider: 'tiktok',
  description: 'Trigger when a published post becomes publicly viewable on TikTok',
  version: '1.0.0',
  icon: TikTokIcon,

  subBlocks: buildTikTokTriggerSubBlocks(
    'tiktok_post_publicly_available',
    'post.publish.publicly_available'
  ),

  outputs: buildTikTokPostingOutputs({ includePostId: true }),

  webhook: {
    method: 'POST',
    headers: { ...TIKTOK_WEBHOOK_HEADERS },
  },
}
