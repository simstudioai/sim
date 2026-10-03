import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionUpdateChargeParams } from '@/tools/oracle_fusion_subscription_management/types'
import { CHARGE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionUpdateChargeTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionUpdateChargeParams>({
    id: 'oracle_fusion_subscription_management_update_charge',
    operation: 'update_charge',
    name: 'Oracle Fusion Subscription Management Update charge',
    description: 'Update charge in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: CHARGE_OUTPUT_PROPERTIES,
      },
    },
  })
