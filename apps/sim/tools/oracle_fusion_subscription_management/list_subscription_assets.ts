import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListSubscriptionAssetsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  PAGINATION_OUTPUTS,
  SUBSCRIPTION_ASSET_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListSubscriptionAssetsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListSubscriptionAssetsParams>({
    id: 'oracle_fusion_subscription_management_list_subscription_assets',
    operation: 'list_subscription_assets',
    name: 'Oracle Fusion Subscription Management List subscription assets',
    description:
      'List subscription assets in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: SUBSCRIPTION_ASSET_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
