import { QuickBooksIcon } from '@/components/icons'
import {
  buildQuickBooksTriggerOutputs,
  buildQuickBooksTriggerSubBlocks,
  QUICKBOOKS_WEBHOOK_HEADERS,
} from '@/triggers/quickbooks/utils'
import type { TriggerConfig } from '@/triggers/types'

export const quickBooksBillEventsTrigger: TriggerConfig = {
  id: 'quickbooks_bill_events',
  name: 'QuickBooks Bill Events',
  provider: 'quickbooks',
  description: 'Trigger when selected Bill events occur in QuickBooks',
  version: '1.0.0',
  icon: QuickBooksIcon,
  subBlocks: buildQuickBooksTriggerSubBlocks('quickbooks_bill_events'),
  outputs: buildQuickBooksTriggerOutputs(),
  webhook: { method: 'POST', headers: { ...QUICKBOOKS_WEBHOOK_HEADERS } },
}
