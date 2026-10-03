import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetBillAdjustmentParams } from '@/tools/oracle_fusion_subscription_management/types'
import { BILL_ADJUSTMENT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetBillAdjustmentTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetBillAdjustmentParams>({
    id: 'oracle_fusion_subscription_management_get_bill_adjustment',
    operation: 'get_bill_adjustment',
    name: 'Oracle Fusion Subscription Management Get bill adjustment',
    description: 'Get bill adjustment in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: BILL_ADJUSTMENT_OUTPUT_PROPERTIES,
      },
    },
  })
