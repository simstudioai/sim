import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionCreateCoveredLevelParams } from '@/tools/oracle_fusion_subscription_management/types'
import { COVERED_LEVEL_OUTPUT_PROPERTIES } from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionCreateCoveredLevelTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionCreateCoveredLevelParams>({
    id: 'oracle_fusion_subscription_management_create_covered_level',
    operation: 'create_covered_level',
    name: 'Oracle Fusion Subscription Management Create covered level',
    description: 'Create covered level in Oracle Fusion using documented subscription fields.',
    outputs: {
      record: {
        type: 'json',
        description: 'Documented subscription record fields',
        properties: COVERED_LEVEL_OUTPUT_PROPERTIES,
      },
    },
  })
