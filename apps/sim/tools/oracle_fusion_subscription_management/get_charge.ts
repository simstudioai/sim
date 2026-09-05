import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetChargeParams } from '@/tools/oracle_fusion_subscription_management/types'
import { CHARGE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetChargeTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetChargeParams>({
    id: 'oracle_fusion_subscription_management_get_charge',
    operation: 'get_charge',
    name: 'Oracle Fusion Subscription Management Get charge',
    description: 'Get charge in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: CHARGE_OUTPUT_PROPERTIES,
      },
    },
  })
