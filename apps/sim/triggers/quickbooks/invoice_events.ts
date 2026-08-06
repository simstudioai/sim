import { QuickBooksIcon } from '@/components/icons'
import {
  buildQuickBooksTriggerOutputs,
  buildQuickBooksTriggerSubBlocks,
  QUICKBOOKS_WEBHOOK_HEADERS,
  quickBooksTriggerOptions,
} from '@/triggers/quickbooks/utils'
import type { TriggerConfig } from '@/triggers/types'

export const quickBooksInvoiceEventsTrigger: TriggerConfig = {
  id: 'quickbooks_invoice_events',
  name: 'QuickBooks Invoice Events',
  provider: 'quickbooks',
  description: 'Trigger when selected Invoice events occur in QuickBooks',
  version: '1.0.0',
  icon: QuickBooksIcon,
  subBlocks: [
    {
      id: 'selectedTriggerId',
      title: 'Trigger Type',
      type: 'dropdown',
      mode: 'trigger',
      options: quickBooksTriggerOptions,
      value: () => 'quickbooks_invoice_events',
      required: true,
    },
    ...buildQuickBooksTriggerSubBlocks('quickbooks_invoice_events'),
  ],
  outputs: buildQuickBooksTriggerOutputs(),
  webhook: { method: 'POST', headers: { ...QUICKBOOKS_WEBHOOK_HEADERS } },
}
