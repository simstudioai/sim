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
export const tiktokVideoUploadFailedTrigger: TriggerConfig = {
  id: 'tiktok_video_upload_failed',
  name: 'TikTok Video Upload Failed',
  provider: 'tiktok',
  description: 'Trigger when a Share Kit / Video Kit upload fails in TikTok',
  version: '1.0.0',
  deprecated: true,
  icon: TikTokIcon,
  subBlocks: buildTikTokTriggerSubBlocks('tiktok_video_upload_failed', 'video.upload.failed'),
  outputs: buildTikTokVideoKitOutputs(),
  webhook: {
    method: 'POST',
    headers: { ...TIKTOK_WEBHOOK_HEADERS },
  },
}
