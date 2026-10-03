import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionUpdateCoveredLevelParams } from '@/tools/oracle_fusion_subscription_management/types'
import { COVERED_LEVEL_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionUpdateCoveredLevelTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionUpdateCoveredLevelParams>({
    id: 'oracle_fusion_subscription_management_update_covered_level',
    operation: 'update_covered_level',
    name: 'Oracle Fusion Subscription Management Update covered level',
    description: 'Update covered level in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: COVERED_LEVEL_OUTPUT_PROPERTIES,
      },
    },
  })
