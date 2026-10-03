import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetBillLineParams } from '@/tools/oracle_fusion_subscription_management/types'
import { BILL_LINE_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetBillLineTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetBillLineParams>({
    id: 'oracle_fusion_subscription_management_get_bill_line',
    operation: 'get_bill_line',
    name: 'Oracle Fusion Subscription Management Get bill line',
    description: 'Get bill line in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: BILL_LINE_OUTPUT_PROPERTIES,
      },
    },
  })
