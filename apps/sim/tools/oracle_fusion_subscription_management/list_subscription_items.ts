import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListSubscriptionItemsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  PAGINATION_OUTPUTS,
  SUBSCRIPTION_ITEM_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListSubscriptionItemsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListSubscriptionItemsParams>({
    id: 'oracle_fusion_subscription_management_list_subscription_items',
    operation: 'list_subscription_items',
    name: 'Oracle Fusion Subscription Management List subscription items',
    description:
      'List subscription items in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: SUBSCRIPTION_ITEM_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
