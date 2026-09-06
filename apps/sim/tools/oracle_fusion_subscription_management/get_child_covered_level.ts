import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetChildCoveredLevelParams } from '@/tools/oracle_fusion_subscription_management/types'
import { CHILD_COVERED_LEVEL_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetChildCoveredLevelTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetChildCoveredLevelParams>({
    id: 'oracle_fusion_subscription_management_get_child_covered_level',
    operation: 'get_child_covered_level',
    name: 'Oracle Fusion Subscription Management Get child covered level',
    description: 'Get child covered level in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: CHILD_COVERED_LEVEL_OUTPUT_PROPERTIES,
      },
    },
  })
