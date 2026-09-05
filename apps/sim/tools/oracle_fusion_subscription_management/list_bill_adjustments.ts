import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListBillAdjustmentsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  BILL_ADJUSTMENT_OUTPUT_PROPERTIES,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListBillAdjustmentsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListBillAdjustmentsParams>({
    id: 'oracle_fusion_subscription_management_list_bill_adjustments',
    operation: 'list_bill_adjustments',
    name: 'Oracle Fusion Subscription Management List bill adjustments',
    description:
      'List bill adjustments in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: BILL_ADJUSTMENT_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
