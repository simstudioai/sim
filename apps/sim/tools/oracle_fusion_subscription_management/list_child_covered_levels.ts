import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListChildCoveredLevelsParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  CHILD_COVERED_LEVEL_OUTPUT_PROPERTIES,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListChildCoveredLevelsTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListChildCoveredLevelsParams>({
    id: 'oracle_fusion_subscription_management_list_child_covered_levels',
    operation: 'list_child_covered_levels',
    name: 'Oracle Fusion Subscription Management List child covered levels',
    description:
      'List child covered levels in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: CHILD_COVERED_LEVEL_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
