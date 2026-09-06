import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListProductsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  PAGINATION_OUTPUTS,
  PRODUCT_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListProductsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListProductsParams>({
    id: 'oracle_fusion_subscription_management_list_products',
    operation: 'list_products',
    name: 'Oracle Fusion Subscription Management List products',
    description:
      'List products in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: PRODUCT_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
