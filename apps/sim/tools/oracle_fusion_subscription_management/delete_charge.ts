import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionDeleteChargeParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionDeleteChargeTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionDeleteChargeParams>({
    id: 'oracle_fusion_subscription_management_delete_charge',
    operation: 'delete_charge',
    name: 'Oracle Fusion Subscription Management Delete charge',
    description:
      'Delete charge in Oracle Fusion. Oracle enforces lifecycle and access restrictions.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle accepted the deletion' },
    },
  })
