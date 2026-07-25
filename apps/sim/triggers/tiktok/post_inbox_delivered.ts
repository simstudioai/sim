import { TikTokIcon } from '@/components/icons'
import {
  buildTikTokPostingOutputs,
  buildTikTokTriggerSubBlocks,
  TIKTOK_WEBHOOK_HEADERS,
} from '@/triggers/tiktok/utils'
import type { TriggerConfig } from '@/triggers/types'

export const tiktokPostInboxDeliveredTrigger: TriggerConfig = {
  id: 'tiktok_post_inbox_delivered',
  name: 'TikTok Post Inbox Delivered',
  provider: 'tiktok',
  description: 'Trigger when a draft notification is delivered to the creator inbox',
  version: '1.0.0',
  icon: TikTokIcon,

  subBlocks: buildTikTokTriggerSubBlocks(
    'tiktok_post_inbox_delivered',
    'post.publish.inbox_delivered'
  ),

  outputs: buildTikTokPostingOutputs(),

  webhook: {
    method: 'POST',
    headers: { ...TIKTOK_WEBHOOK_HEADERS },
  },
}
