import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCreateAssociatedAssetParams } from '@/tools/oracle_fusion_subscription_management/types'
import { ASSOCIATED_ASSET_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCreateAssociatedAssetTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCreateAssociatedAssetParams>({
    id: 'oracle_fusion_subscription_management_create_associated_asset',
    operation: 'create_associated_asset',
    name: 'Oracle Fusion Subscription Management Create associated asset',
    description: 'Create associated asset in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: ASSOCIATED_ASSET_OUTPUT_PROPERTIES,
      },
    },
  })
