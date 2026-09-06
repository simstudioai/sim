import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCreateChargeAdjustmentParams } from '@/tools/oracle_fusion_subscription_management/types'
import { CHARGE_ADJUSTMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCreateChargeAdjustmentTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCreateChargeAdjustmentParams>({
    id: 'oracle_fusion_subscription_management_create_charge_adjustment',
    operation: 'create_charge_adjustment',
    name: 'Oracle Fusion Subscription Management Create charge adjustment',
    description: 'Create charge adjustment in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: CHARGE_ADJUSTMENT_OUTPUT_PROPERTIES,
      },
    },
  })
