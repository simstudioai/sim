import { LinearIcon } from '@/components/icons'
import { buildCustomerRequestOutputs, buildLinearV2SubBlocks } from '@/triggers/linear/utils'
import type { TriggerConfig } from '@/triggers/types'

export const linearCustomerRequestUpdatedV2Trigger: TriggerConfig = {
  id: 'linear_customer_request_updated_v2',
  name: 'Linear Customer Request Updated',
  provider: 'linear',
  description: 'Trigger workflow when a customer request is updated in Linear',
  version: '2.0.0',
  icon: LinearIcon,

  subBlocks: buildLinearV2SubBlocks({
    triggerId: 'linear_customer_request_updated_v2',
    eventType: 'CustomerNeed (update)',
  }),

  outputs: buildCustomerRequestOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Linear-Event': 'CustomerNeed',
      'Linear-Delivery': 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      'Linear-Signature': 'sha256...',
      'User-Agent': 'Linear-Webhook',
    },
  },
}
