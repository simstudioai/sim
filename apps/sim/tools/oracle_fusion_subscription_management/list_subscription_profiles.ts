import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListSubscriptionProfilesParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  PAGINATION_OUTPUTS,
  SUBSCRIPTION_PROFILE_OUTPUT_PROPERTIES,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListSubscriptionProfilesTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListSubscriptionProfilesParams>({
    id: 'oracle_fusion_subscription_management_list_subscription_profiles',
    operation: 'list_subscription_profiles',
    name: 'Oracle Fusion Subscription Management List subscription profiles',
    description:
      'List subscription profiles in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: SUBSCRIPTION_PROFILE_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
