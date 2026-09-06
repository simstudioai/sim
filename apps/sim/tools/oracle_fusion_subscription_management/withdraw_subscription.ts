import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionWithdrawSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionWithdrawSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionWithdrawSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_withdraw_subscription',
    operation: 'withdraw_subscription',
    name: 'Oracle Fusion Subscription Management Withdraw subscription',
    description:
      'Withdraw subscription using the documented Oracle action. Read the record to verify completion.',
    outputs: {
      result: {
        type: 'string',
        description:
          'Documented Oracle action result; a submission message does not mean completion',
      },
    },
  })
