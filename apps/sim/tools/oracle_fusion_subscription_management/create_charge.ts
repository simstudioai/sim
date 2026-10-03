import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCreateChargeParams } from '@/tools/oracle_fusion_subscription_management/types'
import { CHARGE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCreateChargeTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCreateChargeParams>({
    id: 'oracle_fusion_subscription_management_create_charge',
    operation: 'create_charge',
    name: 'Oracle Fusion Subscription Management Create charge',
    description: 'Create charge in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: CHARGE_OUTPUT_PROPERTIES,
      },
    },
  })
