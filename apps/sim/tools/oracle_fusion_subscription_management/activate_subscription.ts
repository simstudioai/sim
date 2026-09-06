import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionActivateSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionActivateSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionActivateSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_activate_subscription',
    operation: 'activate_subscription',
    name: 'Oracle Fusion Subscription Management Activate subscription',
    description:
      'Activate subscription using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
