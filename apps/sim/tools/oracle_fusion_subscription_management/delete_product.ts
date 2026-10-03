import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionDeleteProductParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionDeleteProductTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionDeleteProductParams>({
    id: 'oracle_fusion_subscription_management_delete_product',
    operation: 'delete_product',
    name: 'Oracle Fusion Subscription Management Delete product',
    description:
      'Delete product in Oracle Fusion. Oracle enforces lifecycle and access restrictions.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle accepted the deletion' },
    },
  })
