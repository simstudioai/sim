import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetProductParams } from '@/tools/oracle_fusion_subscription_management/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetProductParams>({
    id: 'oracle_fusion_subscription_management_get_product',
    operation: 'get_product',
    name: 'Oracle Fusion Subscription Management Get product',
    description: 'Get product in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: PRODUCT_OUTPUT_PROPERTIES,
      },
    },
  })
