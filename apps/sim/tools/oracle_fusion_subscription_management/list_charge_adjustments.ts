import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListChargeAdjustmentsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  CHARGE_ADJUSTMENT_OUTPUT_PROPERTIES,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListChargeAdjustmentsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListChargeAdjustmentsParams>({
    id: 'oracle_fusion_subscription_management_list_charge_adjustments',
    operation: 'list_charge_adjustments',
    name: 'Oracle Fusion Subscription Management List charge adjustments',
    description:
      'List charge adjustments in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: CHARGE_ADJUSTMENT_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
