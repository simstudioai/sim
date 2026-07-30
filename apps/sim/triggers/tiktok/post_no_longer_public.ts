import { TikTokIcon } from '@/components/icons'
import {
  buildTikTokPostingOutputs,
  buildTikTokTriggerSubBlocks,
  TIKTOK_WEBHOOK_HEADERS,
} from '@/triggers/tiktok/utils'
import type { TriggerConfig } from '@/triggers/types'

export const tiktokPostNoLongerPublicTrigger: TriggerConfig = {
  id: 'tiktok_post_no_longer_public',
  name: 'TikTok Post No Longer Public',
  provider: 'tiktok',
  description: 'Trigger when a post is no longer publicly viewable on TikTok',
  version: '1.0.0',
  icon: TikTokIcon,

  subBlocks: buildTikTokTriggerSubBlocks(
    'tiktok_post_no_longer_public',
    'post.publish.no_longer_publicaly_available'
  ),

  outputs: buildTikTokPostingOutputs({ includePostId: true }),

  webhook: {
    method: 'POST',
    headers: { ...TIKTOK_WEBHOOK_HEADERS },
  },
}
