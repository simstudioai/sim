import { QuickBooksIcon } from '@/components/icons'
import {
  buildQuickBooksSingleEventTriggerSubBlocks,
  buildQuickBooksTriggerOutputs,
  QUICKBOOKS_WEBHOOK_HEADERS,
} from '@/triggers/quickbooks/utils'
import type { TriggerConfig } from '@/triggers/types'

export const quickBooksPreferencesUpdatedTrigger: TriggerConfig = {
  id: 'quickbooks_preferences_updated',
  name: 'QuickBooks Preferences Updated',
  provider: 'quickbooks',
  description: 'Trigger when QuickBooks Preferences are updated',
  version: '1.0.0',
  icon: QuickBooksIcon,
  subBlocks: buildQuickBooksSingleEventTriggerSubBlocks('quickbooks_preferences_updated'),
  outputs: buildQuickBooksTriggerOutputs(),
  webhook: { method: 'POST', headers: { ...QUICKBOOKS_WEBHOOK_HEADERS } },
}
