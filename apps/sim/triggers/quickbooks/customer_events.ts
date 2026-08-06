import { QuickBooksIcon } from '@/components/icons'
import {
  buildQuickBooksTriggerOutputs,
  buildQuickBooksTriggerSubBlocks,
  QUICKBOOKS_WEBHOOK_HEADERS,
} from '@/triggers/quickbooks/utils'
import type { TriggerConfig } from '@/triggers/types'

export const quickBooksCustomerEventsTrigger: TriggerConfig = {
  id: 'quickbooks_customer_events',
  name: 'QuickBooks Customer Events',
  provider: 'quickbooks',
  description: 'Trigger when selected Customer events occur in QuickBooks',
  version: '1.0.0',
  icon: QuickBooksIcon,
  subBlocks: buildQuickBooksTriggerSubBlocks('quickbooks_customer_events'),
  outputs: buildQuickBooksTriggerOutputs(),
  webhook: { method: 'POST', headers: { ...QUICKBOOKS_WEBHOOK_HEADERS } },
}
