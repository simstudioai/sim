import { TikTokIcon } from '@/components/icons'
import {
  buildTikTokTriggerSubBlocks,
  buildTikTokVideoKitOutputs,
  TIKTOK_WEBHOOK_HEADERS,
} from '@/triggers/tiktok/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Deprecated Share Kit / Video Kit trigger kept registered so existing
 * workflows with this selectedTriggerId continue to resolve.
 */
export const tiktokVideoPublishCompletedTrigger: TriggerConfig = {
  id: 'tiktok_video_publish_completed',
  name: 'TikTok Video Publish Completed',
  provider: 'tiktok',
  description: 'Trigger when a Share Kit / Video Kit upload is published by the user',
  version: '1.0.0',
  deprecated: true,
  icon: TikTokIcon,
  subBlocks: buildTikTokTriggerSubBlocks(
    'tiktok_video_publish_completed',
    'video.publish.completed'
  ),
  outputs: buildTikTokVideoKitOutputs(),
  webhook: {
    method: 'POST',
    headers: { ...TIKTOK_WEBHOOK_HEADERS },
  },
}
