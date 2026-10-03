import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionGetCoveredLevelParams } from '@/tools/oracle_fusion_subscription_management/types'
import { COVERED_LEVEL_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionGetCoveredLevelTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionGetCoveredLevelParams>({
    id: 'oracle_fusion_subscription_management_get_covered_level',
    operation: 'get_covered_level',
    name: 'Oracle Fusion Subscription Management Get covered level',
    description: 'Get covered level in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: COVERED_LEVEL_OUTPUT_PROPERTIES,
      },
    },
  })
