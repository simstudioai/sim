import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListAssociatedAssetsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  ASSOCIATED_ASSET_OUTPUT_PROPERTIES,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListAssociatedAssetsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListAssociatedAssetsParams>({
    id: 'oracle_fusion_subscription_management_list_associated_assets',
    operation: 'list_associated_assets',
    name: 'Oracle Fusion Subscription Management List associated assets',
    description:
      'List associated assets in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: ASSOCIATED_ASSET_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
