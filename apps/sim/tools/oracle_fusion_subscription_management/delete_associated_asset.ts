import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionDeleteAssociatedAssetParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionDeleteAssociatedAssetTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionDeleteAssociatedAssetParams>({
    id: 'oracle_fusion_subscription_management_delete_associated_asset',
    operation: 'delete_associated_asset',
    name: 'Oracle Fusion Subscription Management Delete associated asset',
    description:
      'Delete associated asset in Oracle Fusion. Oracle enforces lifecycle and access restrictions.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle accepted the deletion' },
    },
  })
