import { QuickBooksIcon } from '@/components/icons'
import {
  buildQuickBooksTriggerOutputs,
  buildQuickBooksTriggerSubBlocks,
  QUICKBOOKS_WEBHOOK_HEADERS,
} from '@/triggers/quickbooks/utils'
import type { TriggerConfig } from '@/triggers/types'

export const quickBooksVendorCreditEventsTrigger: TriggerConfig = {
  id: 'quickbooks_vendor_credit_events',
  name: 'QuickBooks Vendor Credit Events',
  provider: 'quickbooks',
  description: 'Trigger when selected Vendor Credit events occur in QuickBooks',
  version: '1.0.0',
  icon: QuickBooksIcon,
  subBlocks: buildQuickBooksTriggerSubBlocks('quickbooks_vendor_credit_events'),
  outputs: buildQuickBooksTriggerOutputs(),
  webhook: { method: 'POST', headers: { ...QUICKBOOKS_WEBHOOK_HEADERS } },
}
