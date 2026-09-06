import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionRenewSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionRenewSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionRenewSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_renew_subscription',
    operation: 'renew_subscription',
    name: 'Oracle Fusion Subscription Management Renew subscription',
    description:
      'Renew subscription using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented renewal result; a successful synchronous result is the new subscription number',
      },
    },
  })
