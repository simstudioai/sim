import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCreateProductParams } from '@/tools/oracle_fusion_subscription_management/types'
import { PRODUCT_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCreateProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCreateProductParams>({
    id: 'oracle_fusion_subscription_management_create_product',
    operation: 'create_product',
    name: 'Oracle Fusion Subscription Management Create product',
    description: 'Create product in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: PRODUCT_OUTPUT_PROPERTIES,
      },
    },
  })
