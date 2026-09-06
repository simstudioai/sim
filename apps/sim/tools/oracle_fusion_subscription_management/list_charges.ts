import { createOracleFusionSubscriptionTool } from '@/tools/oracle_fusion_subscription_management/shared'
import type { OracleFusionSubscriptionListChargesParams } from '@/tools/oracle_fusion_subscription_management/types'
import {
  CHARGE_OUTPUT_PROPERTIES,
  PAGINATION_OUTPUTS,
} from '@/tools/oracle_fusion_subscription_management/types'

export const oracleFusionSubscriptionListChargesTool =
  createOracleFusionSubscriptionTool<OracleFusionSubscriptionListChargesParams>({
    id: 'oracle_fusion_subscription_management_list_charges',
    operation: 'list_charges',
    name: 'Oracle Fusion Subscription Management List charges',
    description:
      'List charges in one bounded Oracle Fusion page. Use documented filters and pagination.',
    outputs: {
      items: {
        type: 'array',
        description: 'One bounded page of subscription records',
        items: { type: 'object', properties: CHARGE_OUTPUT_PROPERTIES },
      },
      ...PAGINATION_OUTPUTS,
    },
  })
