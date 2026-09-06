import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListSubscriptionsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  PAGINATION_OUTPUTS,
  SUBSCRIPTION_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListSubscriptionsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListSubscriptionsParams>({
    id: 'oracle_fusion_subscription_management_list_subscriptions',
    operation: 'list_subscriptions',
    name: 'Oracle Fusion Subscription Management List subscriptions',
    description:
      'List subscriptions in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: SUBSCRIPTION_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
