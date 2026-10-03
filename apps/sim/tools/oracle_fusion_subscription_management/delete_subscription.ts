import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionDeleteSubscriptionParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionDeleteSubscriptionTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionDeleteSubscriptionParams>({
    id: 'oracle_fusion_subscription_management_delete_subscription',
    operation: 'delete_subscription',
    name: 'Oracle Fusion Subscription Management Delete subscription',
    description:
      'Delete subscription in Oracle Fusion. Oracle enforces lifecycle and access restrictions.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle accepted the deletion' },
    },
  })
