import { QuickBooksIcon } from '@/components/icons'
import {
  buildQuickBooksTriggerOutputs,
  buildQuickBooksTriggerSubBlocks,
  QUICKBOOKS_WEBHOOK_HEADERS,
} from '@/triggers/quickbooks/utils'
import type { TriggerConfig } from '@/triggers/types'

export const quickBooksPaymentEventsTrigger: TriggerConfig = {
  id: 'quickbooks_payment_events',
  name: 'QuickBooks Payment Events',
  provider: 'quickbooks',
  description: 'Trigger when selected Payment events occur in QuickBooks',
  version: '1.0.0',
  icon: QuickBooksIcon,
  subBlocks: buildQuickBooksTriggerSubBlocks('quickbooks_payment_events'),
  outputs: buildQuickBooksTriggerOutputs(),
  webhook: { method: 'POST', headers: { ...QUICKBOOKS_WEBHOOK_HEADERS } },
}
