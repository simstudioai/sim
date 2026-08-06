import { QuickBooksIcon } from '@/components/icons'
import {
  buildQuickBooksTriggerOutputs,
  buildQuickBooksTriggerSubBlocks,
  QUICKBOOKS_WEBHOOK_HEADERS,
} from '@/triggers/quickbooks/utils'
import type { TriggerConfig } from '@/triggers/types'

export const quickBooksVendorEventsTrigger: TriggerConfig = {
  id: 'quickbooks_vendor_events',
  name: 'QuickBooks Vendor Events',
  provider: 'quickbooks',
  description: 'Trigger when selected Vendor events occur in QuickBooks',
  version: '1.0.0',
  icon: QuickBooksIcon,
  subBlocks: buildQuickBooksTriggerSubBlocks('quickbooks_vendor_events'),
  outputs: buildQuickBooksTriggerOutputs(),
  webhook: { method: 'POST', headers: { ...QUICKBOOKS_WEBHOOK_HEADERS } },
}
