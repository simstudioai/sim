import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetChargeAdjustmentParams } from '@/tools/oracle_fusion_subscription_management/types'
import { CHARGE_ADJUSTMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetChargeAdjustmentTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetChargeAdjustmentParams>({
    id: 'oracle_fusion_subscription_management_get_charge_adjustment',
    operation: 'get_charge_adjustment',
    name: 'Oracle Fusion Subscription Management Get charge adjustment',
    description: 'Get charge adjustment in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: CHARGE_ADJUSTMENT_OUTPUT_PROPERTIES,
      },
    },
  })
