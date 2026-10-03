import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListCoveredLevelsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  COVERED_LEVEL_OUTPUT_PROPERTIES,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListCoveredLevelsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListCoveredLevelsParams>({
    id: 'oracle_fusion_subscription_management_list_covered_levels',
    operation: 'list_covered_levels',
    name: 'Oracle Fusion Subscription Management List covered levels',
    description:
      'List covered levels in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: COVERED_LEVEL_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
