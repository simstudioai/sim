import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionDeleteCoveredLevelParams } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionDeleteCoveredLevelTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionDeleteCoveredLevelParams>({
    id: 'oracle_fusion_subscription_management_delete_covered_level',
    operation: 'delete_covered_level',
    name: 'Oracle Fusion Subscription Management Delete covered level',
    description:
      'Delete covered level in Oracle Fusion. Oracle enforces lifecycle and access restrictions.',
    outputs: {
      deleted: { type: 'boolean', description: 'Oracle accepted the deletion' },
    },
  })
