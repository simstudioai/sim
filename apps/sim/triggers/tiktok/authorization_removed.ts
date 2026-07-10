import { TikTokIcon } from '@/components/icons'
import {
  buildTikTokAuthorizationRemovedOutputs,
  buildTikTokTriggerSubBlocks,
  TIKTOK_WEBHOOK_HEADERS,
} from '@/triggers/tiktok/utils'
import type { TriggerConfig } from '@/triggers/types'

export const tiktokAuthorizationRemovedTrigger: TriggerConfig = {
  id: 'tiktok_authorization_removed',
  name: 'TikTok Authorization Removed',
  provider: 'tiktok',
  description: 'Trigger when a user deauthorizes your TikTok app',
  version: '1.0.0',
  icon: TikTokIcon,

  subBlocks: buildTikTokTriggerSubBlocks('tiktok_authorization_removed', 'authorization.removed'),

  outputs: buildTikTokAuthorizationRemovedOutputs(),

  webhook: {
    method: 'POST',
    headers: { ...TIKTOK_WEBHOOK_HEADERS },
  },
}
