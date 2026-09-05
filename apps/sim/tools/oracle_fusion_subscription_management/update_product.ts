import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionUpdateProductParams } from '@/tools/oracle_fusion_subscription_management/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionUpdateProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionUpdateProductParams>({
    id: 'oracle_fusion_subscription_management_update_product',
    operation: 'update_product',
    name: 'Oracle Fusion Subscription Management Update product',
    description: 'Update product in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: PRODUCT_OUTPUT_PROPERTIES,
      },
    },
  })
