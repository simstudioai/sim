import { TikTokIcon } from '@/components/icons'
import {
  buildTikTokTriggerSubBlocks,
  buildTikTokVideoKitOutputs,
  TIKTOK_WEBHOOK_HEADERS,
} from '@/triggers/tiktok/utils'
import type { TriggerConfig } from '@/triggers/types'

export const tiktokVideoUploadFailedTrigger: TriggerConfig = {
  id: 'tiktok_video_upload_failed',
  name: 'TikTok Video Upload Failed',
  provider: 'tiktok',
  description: 'Trigger when a Share Kit / Video Kit upload fails in TikTok',
  version: '1.0.0',
  icon: TikTokIcon,

  subBlocks: buildTikTokTriggerSubBlocks('tiktok_video_upload_failed', 'video.upload.failed'),

  outputs: buildTikTokVideoKitOutputs(),

  webhook: {
    method: 'POST',
    headers: { ...TIKTOK_WEBHOOK_HEADERS },
  },
}
