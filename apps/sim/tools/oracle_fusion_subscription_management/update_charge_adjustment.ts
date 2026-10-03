import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionUpdateChargeAdjustmentParams } from '@/tools/oracle_fusion_subscription_management/types'
import { CHARGE_ADJUSTMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionUpdateChargeAdjustmentTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionUpdateChargeAdjustmentParams>({
    id: 'oracle_fusion_subscription_management_update_charge_adjustment',
    operation: 'update_charge_adjustment',
    name: 'Oracle Fusion Subscription Management Update charge adjustment',
    description: 'Update charge adjustment in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: CHARGE_ADJUSTMENT_OUTPUT_PROPERTIES,
      },
    },
  })
