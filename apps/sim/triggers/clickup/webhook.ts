import { ClickUpIcon } from '@/components/icons'
import { buildClickUpTriggerSubBlocks } from '@/triggers/clickup/subblocks'
import { buildClickUpGenericOutputs } from '@/triggers/clickup/utils'
import type { TriggerConfig } from '@/triggers/types'

export const clickupWebhookTrigger: TriggerConfig = {
  id: 'clickup_webhook',
  name: 'ClickUp Webhook',
  provider: 'clickup',
  description: 'Trigger workflow on any ClickUp event (subscribes to all events)',
  version: '1.0.0',
  icon: ClickUpIcon,
  subBlocks: buildClickUpTriggerSubBlocks('clickup_webhook'),
  outputs: buildClickUpGenericOutputs(),
  webhook: {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Signature': 'hmac-sha256-signature' },
  },
}
