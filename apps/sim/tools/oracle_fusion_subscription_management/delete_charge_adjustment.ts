import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionDeleteChargeAdjustmentParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionDeleteChargeAdjustmentTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionDeleteChargeAdjustmentParams>({
    id: 'oracle_fusion_subscription_management_delete_charge_adjustment',
    operation: 'delete_charge_adjustment',
    name: 'Oracle Fusion Subscription Management Delete charge adjustment',
    description:
      'Delete charge adjustment in Oracle Fusion. Oracle enforces lifecycle and access restrictions.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle accepted the deletion' },
    },
  })
